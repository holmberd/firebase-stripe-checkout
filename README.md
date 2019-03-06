## Firebase Stripe Checkout
Service API that handles Stripe order creation and processing.
Order is processed by checking out keys in Firestore associated with a Stripe SKU ID.
Stripe customer is created based on email address and charge is added to customer.
