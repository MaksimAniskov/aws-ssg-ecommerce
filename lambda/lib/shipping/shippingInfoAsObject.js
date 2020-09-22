const countries = require('./countries.json')

exports.calculateShippingCost = ({ shippingInfo, country, cart, inventory }) => {
    try {
        const shippingCost = cart.reduce(
            (acc, item) => {
                let itemShippingInfo = item.shipping;
                if (!itemShippingInfo && inventory) {
                    itemShippingInfo = getShippingRulesBySku({ inventory, sku: item.sku })
                }
                if (!itemShippingInfo) {
                    itemShippingInfo = {}
                }

                {
                    checkShippingRestrictions({ restrictions: itemShippingInfo.restrictions, country })
                    const val = calcShippingCost({ costRules: itemShippingInfo.cost, country })
                    if (isDefined(val)) {
                        return acc + val * item.quantity
                    }
                }

                let category = itemShippingInfo.category
                if (!category && inventory) {
                    const sr = getShippingRulesBySku({ inventory, sku: item.sku })
                    if (sr) {
                        category = sr.category
                    }
                }
                checkShippingRestrictions({ restrictions: shippingInfo.restrictions, country, category })
                const val = calcShippingCost({ costRules: shippingInfo.cost, country, category })
                if (isDefined(val)) {
                    return acc + val * item.quantity
                }

                const countryName = countries
                    .find(({ code }) => code === country).name;
                throw new Error(`We do not ship to ${countryName}`)
            },
            0
        )
        return { shippingCost }
    } catch (error) {
        return { error }
    }

    function calcShippingCost({ country, category, costRules }) {
        if (!costRules) {
            return null
        }
        if (category && shippingInfo.cost.byCategory) {
            const val = calcShippingCost({ country, costRules: shippingInfo.cost.byCategory[category] })
            if (isDefined(val)) {
                return val
            }
        }
        if (costRules.byCountry) {
            const val = costRules.byCountry[country]
            if (isDefined(val)) {
                return val
            }
        }
        if (costRules.byContinent) {
            const val = costRules.byContinent[getContinentByCountry(country)]
            if (isDefined(val)) {
                return val
            }
        }
        return costRules.default
    }

    function checkShippingRestrictions({ country, category, restrictions }) {
        if (!restrictions) {
            return
        }
        if (restrictions.byCountry) {
            const r = restrictions.byCountry[country]
            if (r) {
                throw new Error(r)
            } else if (typeof r === 'object') {
                return;
            }
        }
        if (restrictions.byContinent) {
            const r = restrictions.byContinent[getContinentByCountry(country)]
            if (r) {
                throw new Error(r)
            } else if (typeof r === 'object') {
                return;
            }
        }
        if (category && shippingInfo.restrictions && shippingInfo.restrictions.byCategory) {
            checkShippingRestrictions({ country, restrictions: shippingInfo.restrictions.byCategory[category] })
        }
        if (restrictions.default) {
            throw new Error(restrictions.default)
        }
    }

    function getContinentByCountry(country) {
        const entry = countries.find(({ code }) => code === country)
        if (entry) {
            return entry.continent
        }
    }

    function getShippingRulesBySku({ sku, inventory }) {
        const entry = inventory.find((i) => i.name === sku)
        if (entry) {
            return entry.shipping
        }
    }

    function isDefined(val) {
        return !['object', 'undefined'].includes(typeof val)
    }

}
