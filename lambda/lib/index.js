const { calculateShippingCost } = require('./shipping/shippingInfoAsObject');
const aws = require('aws-sdk');
const unzipper = require('unzipper');
const s3 = new aws.S3();
const ses = new aws.SES({ region: process.env.SES_REGION });
const assert = require('assert')
const { inspect } = require('util')

exports.loadShopDatabase = async () => {
    const shopDatabaseBucketName = process.env.SHOP_DATABASE_BUCKET_NAME;
    const archives = [
        { name: 'inventory', fileName: process.env.INVENTORY_ARCHIVE_FILE_NAME },
        { name: 'shippingRules', fileName: process.env.SHIPPING_RULES_ARCHIVE_FILE_NAME },
        { name: 'shopSettings', fileName: process.env.SHOP_SETTINGS_ARCHIVE_FILE_NAME },
    ];
    console.log(inspect({ shopDatabaseBucketName, archives}));

    const data = await Promise.all(
        archives.map(({ name, fileName }) =>
            new Promise((resolve, reject) =>
                s3
                    .getObject({
                        Bucket: shopDatabaseBucketName,
                        Key: fileName
                    })
                    .createReadStream()
                    .pipe(unzipper.Parse())
                    .on('entry', async (entry) => {
                        console.log({ entry: { path: entry.path, type: entry.type } });
                        resolve({ name, data: JSON.parse(await entry.buffer()) });
                    })
                    .on('error', reject)
            )
        )
    );

    return data.reduce(
        (acc, { name, data }) => { acc[name] = data; return acc },
        {}
    );
}

exports.checkOrder = ({ inventory, shippingRules, shopSettings, order }) => {
    console.log('checkOrder', inspect({ order }));

    const calculatedTotal = order.items.reduce(
        (acc, { sku, price, quantity }) => {
            assert(
                checkItem({ inventory, sku, price, quantity }),
                'Incorrect price value or low inventory'
            );
            return acc + price * quantity;
        },
        0
    );
    assert.equal(order.total, calculatedTotal, 'Incorrect total');

    if (shippingRules) {
        const { shippingCost: calculatedShippingCost, error } = calculateShippingCost({ shippingInfo: shippingRules, country: order.country, cart: order.items, inventory })
        assert.ifError(error);
        assert.equal(order.shippingCost, calculatedShippingCost, 'Incorrect shipping cost');
    } else {
        assert.equal(order.shippingCost, 0, 'Incorrect shipping cost');
    }
}

function checkItem({ inventory, sku, price, quantity }) {
    const item = inventory.filter(({ name }) => name == sku)[0];
    console.log({ item });
    const result = item.price === price && item.currentInventory >= quantity;
    console.log({ result });
    return result;
}

exports.sendOrderConfirmation = async ({ to, from, data, sesTemplateName }) => {
    return ses.sendTemplatedEmail(
        {
            Destination: { ToAddresses: [to] },
            Source: from,
            Template: sesTemplateName,
            TemplateData: JSON.stringify(data)
        }
    ).promise();
}

