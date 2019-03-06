## Firebase Stripe Checkout
Stripe Service API that handles Stripe order creation, checkout and processing.

## Prerequisites
- Stripe
- Firebase functions
- Firestore
- Email Service

## Up and Running
- Setup Firebase functions: https://firebase.google.com/docs/functions/get-started
- Setup Firestore: https://firebase.google.com/docs/firestore/quickstart
- Setup Email Service Endpoint
- Setup Web Client to call our Service API to create Stripe order
- Add Stripe products and 
- Configure Stripe `order.payment_succeeded` Webhook-URL to point to Service API: `/webhook`

## Flow
1. Order is created from client.
2. User is charged for order products and payment is successfull.
  - Customer is created in Stripe
  - Payment source is added to customer
  - Customer is charged for order
3. Stripe fires `order.payment_succeeded` to webhook handler on successfull payment.
4. Service API webhook endpoint is triggered from Stripe with `orderId` and order processing is started.
5. Order processing checkout keys from Firestore based on product SKU and quantity in order.
  - This is performed as a batch since we want to return keys to Firestore if something fails.
6. Keys are checked out and sent in request to Email Service Endpoint for delivery.
