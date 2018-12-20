/*jshint esversion: 6 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/** Firestore settings */
const settings = {timestampsInSnapshots: true};
admin.firestore().settings(settings);

const request = require('request-promise-native');
const express = require('express');
const cors = require('cors');
const stripeKey = functions.config().stripe.testkey;
const stripe = require('stripe')(stripeKey);

const app = express();

// TODO: set cors to abgames.io after testing complete.
app.use(cors({ origin: true }));

/**
 * POST /checkout - Order checkout handler endpoint.
 * Creates and returns a customer order.
 *
 * @returns {Object} - JSON response
 */
app.post('/checkout', (req, res) => {
  console.log('Checkout started');
  if (!req.body.hasOwnProperty('customer') || !req.body.hasOwnProperty('items')) {
    return res.status(400).json({error: 'Bad request'});
  }
  const customer = req.body.customer;
  const skus = req.body.items;

  return getOrCreateCustomer(customer.email)
    .then(customer => createOrder(customer, skus))
    .then(order => {
      console.log('Checkout completed');
      return res.json({result: order})
    })
    .catch(err => {
      console.error(err);
      return res.status(500).json({error: 'Failed to create customer order'});
    });
});

/**
 * POST /order/:id/charge - Customer order payment endpoint.
 * Creates a customer charge source and pays order.
 *
 * @returns {Object} - JSON response
 */
app.post('/order/:id/charge', (req, res) => {
  console.log('Charge order id:', req.params.id);
  console.log('request body', req.body);
  if (!req.body.hasOwnProperty('stripeToken')) {
    return res.status(400).json({error: 'Bad request'});
  }
  const tokenId = req.body.stripeToken;
  const orderId = req.params.id;

  return getOrder(orderId)
    .then(order => {
      if (!order.customer) {
        throw new Error('No customer associated with order');
      }
      return getCustomerById(order.customer);
    })
    .then(customer => {
      if (customer.deleted) {
        throw new Error('Customer associated with the order is deleted');
      }
      return createCustomerSource(customer, tokenId);
    })
    .then(customer => payOrder(orderId, customer.id))
    .then(order => {
      console.log('Order charged successfully');
      return res.json({result: order})
    })
    .catch(err => {
      console.error(err);
      return res.status(500).json({error: 'Failed to pay order'});
    });
});

/**
 * POST /order/:id/cancel - Cancels an order.
 * Cancels the order associated with the specified id.
 *
 * @returns {Object} - JSON response
 */
app.post('/order/:id/cancel', (req, res) => {
  console.info('Cancel Order id:', req.params.id);
  const orderId = req.params.id;
  return getOrder(orderId)
  .then(() => cancelOrder(req.params.id))
  .then(() => res.json({result: true}))
  .catch(err => {
    console.error(err);
    return res.status(500).json({error: 'Failed to cancel order'});
  });
});

/**
 * POST /webhook - Stripe webhook events handler.
 * Sends a request to the EmailService on a successfull order payment event.
 *
 * @returns {Object} - JSON response
 */
app.post('/webhook', (req, res) => {
  console.info('Stripe webhook triggered');
  if (req.body.hasOwnProperty('id') && req.body.type === 'order.payment_succeeded') {
    console.log('Order Payment Succeeded Event');
    const orderId = req.body.data.object.id;
    const email = req.body.data.object.email;
    const items = req.body.data.object.items;
    const skus = items.filter(item => {
      return item.type === 'sku';
    });
    console.info('Start processing order');
    return processOrder(orderId, skus)
      .then(keyItems => {
        const body = {
          email: email,
          items: keyItems
        };
        console.info('Order processed successfully');
        console.info('Sending request to EmailService', body);
        return sendRequestToEmailService(body);
      })
      .then(() => {
        console.info('Request to EmailService was successfull');
        return res.send(200);
      })
      .catch(err => {
        console.error(err)
        return res.send(200);
      });
  }
  return res.send(200);
});


exports.stripe = functions.https.onRequest(app);

/** Private Methods */

/**
 * Sends a POST request to the EmailService.
 *
 * @param {Object} body
 * @returns {Promise}
 */
function sendRequestToEmailService(body) {
    const requestOpts = {
    uri: functions.config().api.emailservice,
    aws: {
      sign_version: 4,
      key: functions.config().aws.access_key,
      secret: functions.config().aws.secret_key,
      service: 'execute-api',
    },    
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    json: body
  };
  return request.post(requestOpts)
  .catch(err => {
    err.message = 'Request to EmailService failed: ' + err.message;
    return Promise.reject(err);
  });
}

/**
 * Processes an orders product skus.
 *
 * @param {String} orderId
 * @param {Object[]} skus
 * @returns {Promise}
 */
function processOrder(orderId, skus) {
  var steamKeyItems = {};
  var batch = admin.firestore().batch();
  return isOrderProcessed(orderId)
    .then(isProcessed => {
      if (isProcessed) {
        throw new Error('Order already processed');
      }
      return checkoutSteamGameKeys(batch, skus);
    })
    .then(keyItems => {
      steamKeyItems = keyItems;
      return createOrderDoc(batch, orderId, {isProcessed: true});
    })
    .then(() => batch.commit())
    .then(() => steamKeyItems)
    .catch(err => {
      err.message = 'Failed to process order: ' + err.message;
      return Promise.reject(err);
    });
}

/**
 * Checkout steam keys from the firestore database.
 *
 * @param {Firestore.Batch} batch
 * @param {Object[]} skus
 * @returns {Promise}
 */
function checkoutSteamGameKeys(batch, skus) {
  const skuPromises = skus.map(sku => {
    return {
      keys: checkoutSteamGameKey(batch, sku.parent, sku.quantity),
      description: sku.description,
    };
  })
  return Promise.all(skuPromises)
    .catch(err => {
      err.message = 'Failed to checkout Steam game keys: ' + err.message;
      return Promise.reject(err);
    })
}

/**
 * Checkout a steam key from firestore SKU document.
 *
 * @param {Firestore.Batch} batch
 * @param {String} skuId
 * @param {Number} quanity
 * @returns {Promise}
 */
function checkoutSteamGameKey(batch, skuId, quantity) {
  return getSteamKeys(skuId)
    .then(steamKeys => {
      if (!steamKeys) {
        throw new Error('sku has no associated steamkey');
      }
      var keys = [];
      for (var i = 0; i < quantity; i++) {
        keys.push(steamKeys.pop());
      }
      updateSteamKeys(batch, skuId, steamKeys)
      return keys;
    })
    .catch(err => {
      err.message = 'Failed to checkout steam key: ' + err.message;
      return Promise.reject(err);
    });
}

/**
 * Updates all steamkeys for a specific sku id.
 *
 * @param {Firestore.Batch} batch
 * @param {String} skuId
 * @param {Object[]} keys
 * @returns {Promise}
 */
function updateSteamKeys(batch, skuId, keys) {
  var steamDoc = admin.firestore().collection('steam').doc(skuId);
  return batch.update(steamDoc, {keys: keys});
}

/**
 * Returns all steamkeys associated with a SKU id.
 *
 * @param {String} skuId
 * @returns {Promise}
 */
function getSteamKeys(skuId) {
  return admin.firestore().collection('steam').doc(skuId).get()
    .then(doc => {
      if (doc.exists) {
        return doc.data().keys;
      }
      return null;
    })
    .catch(err => {
      err.message = 'Failed to retrive steamkeys: ' + err.message;
      throw err;
    })
}

/**
 * Check wether an order has been processed.
 *
 * @param {String} orderId
 * @returns {Promise}
 */
function isOrderProcessed(orderId) {
  return getOrderDoc(orderId)
    .then(doc => {
      if (doc) {
        return doc.isProcessed;
      }
      return false;
    });
}

/**
 * Creates a new order document in firestore.
 *
 * @param {Firestore.Batch} batch
 * @param {String} orderId
 * @param {Object} data
 * @returns {Promise}
 */
function createOrderDoc(batch, orderId, data) {
  var orderDoc = admin.firestore().collection('orders').doc(orderId);
  return batch.set(orderDoc, data);
}

/**
 * Returns an order document from firebase.
 *
 * @param {String} orderId
 * @returns {Promise}
 */
function getOrderDoc(orderId) {
  return admin.firestore().collection('orders').doc(orderId).get()
    .then(doc => {
      if (doc.exists) {
        return doc.data();
      }
      return null;
    })
    .catch(err => {
      err.message = 'Failed to retrive order doc: ' + err.message;
      throw err;
    })
}

/**
 * Cancels an order.
 *
 * @param {String} orderId
 * @returns {Promise}
 */
function cancelOrder(orderId) {
  return stripe.orders.update(orderId, {
    status: 'canceled'
  });
}

/**
 * Fetches and returns an order.
 *
 * @param {String} orderId
 * @returns {Promise}
 */
function getOrder(orderId) {
  return stripe.orders.retrieve(orderId)
    .catch(err => {
      err.message = 'Failed to retrive order: ' + err.message;
      throw err;
    });
}

/**
 * Creates a new order.
 *
 * @param {Object} customer
 * @param {Object[]} skus
 * @returns {Promise}
 */
function createOrder(customer, skus) {
  return stripe.orders.create({
    currency: 'usd',
    items: skus.map(sku => {
      return {
        type: 'sku',
        parent: sku.id,
        quantity: sku.quantity
      };
    }),
    customer: customer.id
  })
  .catch(err => {
    err.message = 'Failed to create order: ' + err.message;
    throw err;
  });
}

/**
 * Pays for an order.
 *
 * @param {String} orderId
 * @param {String} customerId
 * @returns {Promise}
 */
function payOrder(orderId, customerId) {
  return stripe.orders.pay(orderId, {
    customer: customerId
  })
  .catch(err => {
    err.message = 'Failed to pay for order: ' + err.message;
    throw err;
  });
}

/**
 * Gets a customer by id.
 *
 * @param {String} customerId
 * @returns {Promise}
 */
function getCustomerById(customerId) {
  return stripe.customers.retrieve(customerId)
    .catch(err => {
      err.message = 'Failed to retrive customer: ' + err.message;
      throw err;
    });
}

/**
 * Gets or creates a new customer.
 *
 * @param {String} email
 * @returns {Promise}
 */
function getOrCreateCustomer(email) {
  return getCustomerByEmail(email)
    .then(customer => {
      if (customer) {
        return customer;
      } else {
        return createCustomer(email);
      }
    });
}

/**
 * Creates a new customer.
 *
 * @param {String} email
 * @returns {Promise}
 */
function createCustomer(email) {
  return stripe.customers.create({email})
    .catch(err => {
      err.message = 'Failed to create customer: ' + err.message;
      throw err;
    });
}

/**
 * Fetches a customer by email.
 *
 * @param {String} email
 * @returns {Promise}
 */
function getCustomerByEmail(email) {
  return stripe.customers.list({email: email, limit: 1})
    .then(customers => {
      if (customers.data.length) {
        return customers.data[0];
      } else {
        return null;
      }
    })
    .catch(err => {
      err.message = 'Failed to retrive customers list: ' + err.message;
      throw err;
    });
}

/**
 * Creates and attaches a payment source to a customer.
 *
 * @param {String} email
 * @param {String} tokenId
 * @returns {Promise}
 */
function createCustomerSource(customer, tokenId) {
  return stripe.customers.createSource(customer.id, {
    source: tokenId
  })
  .then(source => customer)
  .catch(err => {
    err.message = 'Failed to create customer source: ' + err.message;
    throw err;
  });
}
