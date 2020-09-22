const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { loadShopDatabase, checkOrder, sendOrderConfirmation } = require('./lib');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { inspect } = require('util');

const app = module.exports = express();

const corsOrigins = process.env.CORS_ORIGINS.split(',');
app.use(cors((req, callback) => {
    callback(null, {
        origin: corsOrigins.indexOf(req.header('Origin')) !== -1
    });
}));

app.post('/paymentintent', bodyParser.json({ limit: '1mb' }), async (req, res, next) => {
    try {
        console.log('POST /paymentintent body:', req.body);

        const { items, country, total, shippingCost } = req.body;
        const { inventory, shippingRules, shopSettings } = await loadShopDatabase();
        checkOrder({
            inventory, shippingRules, shopSettings,
            order: { items, country, total, shippingCost }
        });

        let amount = total + shippingCost;
        if (!shopSettings.isZeroDecimal) {
            amount = Math.round(amount * 100);
        }

        if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SIGNING_SECRET) {
            const stripeResponse = await stripe.paymentIntents.create({
                amount,
                currency: shopSettings.currency && shopSettings.currency.code ? shopSettings.currency.code : 'EUR',
                metadata: {
                    itemsJson: JSON.stringify(items),
                    paymentJson: JSON.stringify({ total, shippingCost, currencyCode: shopSettings.currency.code })
                }
            });
            console.log(inspect({ stripeResponse }));
            res.status(200).json({ stripeClientSecret: stripeResponse.client_secret });
        } else {
            console.log('Either STRIPE_SECRET_KEY or STRIPE_SIGNING_SECRET not set. Run dry.');
            res.status(200).json({ error: { message: 'Payment provider is not configured. Please contact the shop owner.' } });
        }
    }
    catch (error) {
        next(error);
    }
});

app.post('/stripewebhook', bodyParser.raw({ type: 'application/json', limit: '1mb' }), async (req, res, next) => {
    try {
        const stripeEvent = stripe.webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            process.env.STRIPE_SIGNING_SECRET
        );
        if (stripeEvent.type === 'payment_intent.succeeded') {
            const { id, amount_received, charges } = stripeEvent.data.object;
            const { metadata, shipping, receipt_email } = charges.data[0];
            const items = JSON.parse(metadata.itemsJson)
            const payment = JSON.parse(metadata.paymentJson)
            console.log(inspect({ id, amount_received, items, payment, shipping }));

            const sendParams = {
                from: process.env.FROM_EMAIL,
                sesTemplateName: process.env.SES_TEMPLATE_NAME,
                data: {
                    ordernum: id,
                    itemsdescription: items
                        .map(item => (item.quantity > 1 ? `${item.quantity}x ` : '') + item.sku)
                        .join(', '),
                    currency: payment.currencyCode,
                    total: payment.total,
                    shippinghandlingcost: payment.shippingCost,
                    taxes: 0,
                    grandtotal: payment.total + payment.shippingCost,
                    shippingaddress: `${shipping.address.line1} 
                                      ${shipping.address.line2}
                                      ${shipping.address.city} ${shipping.address.state} ${shipping.address.postal_code}
                                      ${shipping.address.country}`,
                    shopname: process.env.SHOP_NAME,
                    shopurl: process.env.SHOP_URL,
                    shoplegaladdress: process.env.SHOP_LEGAL_ADDRESS
                }
            };

            console.log({ SEND_ORDER_CONFIRMATION_EMAIL: process.env.SEND_ORDER_CONFIRMATION_EMAIL });
            if (process.env.SEND_ORDER_CONFIRMATION_EMAIL.includes('to the shop')) {
                await sendOrderConfirmation({ to: process.env.SHOP_EMAIL, ...sendParams });
            }
            if (process.env.SEND_ORDER_CONFIRMATION_EMAIL.includes('to the buyer')) {
                await sendOrderConfirmation({ to: receipt_email, ...sendParams });
            }
        }
        res.status(200).send();
    }
    catch (error) {
        next(error);
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.log('err:', JSON.stringify(err), err.message);
    console.log(`${err}. url ${req.url}` + (err.stack ? `\nStack: ${err.stack}` : ''));
    if (res.headersSent) {
        return next(err);
    }
    let status, message = err.message;
    switch (err.code) {
        case 'ERR_ASSERTION': status = 400; break;
        default: status = 500; message = 'Something went wrong';
    }
    res
        .status(status ? status : 500)
        .json({ error: { message } });
});
