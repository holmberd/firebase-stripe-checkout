## Firebase Stripe Checkout
Stripe Service API that handles Stripe checkout, order creation and processing.

## Prerequisites
- Stripe
- Firebase functions
- Firestore
- Email Service

## Up and Running
- Setup Firebase functions: https://firebase.google.com/docs/functions/get-started
- Setup Firestore: https://firebase.google.com/docs/firestore/quickstart
- Setup Email Service Endpoint
- Setup Web Client to call our Service API to create Stripe order on Stripe checkout
  - Fetch product and associated SKUs from Stripe based on `product_id`
- Add Stripe products and SKUs with `type` attribute
- Configure Stripe Webhook: `order.payment_succeeded` to point to Service API: `/webhook`

## Caching
- Products can be cached in Redis on `product_id` to limit calls to Stripe
- Add Stripe webhook handler to invalidate cache on changes to product

## Flow
1. Order is created from client.
2. User is charged for order products and payment is successfull.
  - Customer is created in Stripe
  - Payment source is added to customer
  - Customer is charged for order
3. Stripe fires `order.payment_succeeded` to webhook handler on successfull payment.
4. Service API webhook endpoint is triggered from Stripe with `orderId` and order processing is started.
5. Order processing checkout keys from Firestore based on product SKU and quantity in order.
  - This is performed as a batch since we want to return keys to its collection if something fails.
  - Processed orders are stored in the Firestore `orders` collection.
6. Keys are checked out and sent in request to Email Service Endpoint for delivery.

## Collections

### SKUs
```js
{ 
  "skus": {
    "sku_E5XI0qzHKWPdJQ": { 
      "keys": [
        "C5YFR-XEE29-V3CP8",
        "E9B98-LG43D-9QP3K"
       ]
    }
  }
}
```
