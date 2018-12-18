/*jshint esversion: 6 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/** Firestore settings */
const settings = {timestampsInSnapshots: true};
admin.firestore().settings(settings);

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
  console.info('Checkout started');
  if (!req.body.hasOwnProperty('customer') || !req.body.hasOwnProperty('items')) {
    return res.status(400).json({error: 'Bad request'});
  }
  const customer = req.body.customer;
  const skus = req.body.items;

  return getOrCreateCustomer(customer.email)
    .then(customer => createOrder(customer, skus))
    .then(order => res.json({result: order}))
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
  console.info('Charge order id:', req.params.id);
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
    .then(order => res.json({result: order}))
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
  console.info('Cancel order id:', req.params.id);
  const orderId = req.params.id;
  return getOrder(orderId)
  .then(() => cancelOrder(req.params.id))
  .then(() => res.json({result: true}))
  .catch(err => {
    console.error(err);
    return res.status(500).json({error: 'Failed to cancel order'});
  });
});


exports.stripe = functions.https.onRequest(app);


/** Private Methods */

/**
 * Cancels an order.
 *
 * @param {String} orderId
 * @throws {Error}
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
 * @throws {Error}
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
 * @throws {Error}
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
 * @throws {Error}
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
 * @throws {Error}
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
 * @throws {Error}
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
 * @throws {Error}
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
 * @throws {Error}
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
 * @throws {Error}
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
