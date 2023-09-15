import SchemaManager from '@tf2autobot/tf2-schema';
import { BpCreateListingDTO, CreateListingDTO, Manager, RemoveListingDTO } from './classes/manager';
import TF2Currencies from '@tf2autobot/tf2-currencies';
import SKU from '@tf2autobot/tf2-sku';

export class ListingManager {
    public manager: Manager;

    private steamid: string;

    private token: string;

    private userAgent: string;

    private schema: SchemaManager.Schema;

    public ready = false;

    private _updateInventoryInterval: ReturnType<typeof setInterval>;

    // { [sku: string]: assetid }
    private sellListings: { [sku: string]: string } = {};

    private queue: {
        create: CreateListingDTO[];
        delete: RemoveListingDTO[];
    } = {
        create: [],
        delete: []
    };

    private handleQueueInterval = setInterval(this.handleQueue.bind(this), 250);

    constructor(options: ConstructorOptions) {
        this.steamid = options.steamid;
        this.token = options.token;
        this.userAgent = options.userAgent;
        this.schema = options.schema;

        this.manager = new Manager(`http://${options.host}:${options.port}`, this.steamid);
    }

    async handleQueue() {
        const createBatch = this.queue.create.splice(0, 1000);
        const deleteBatch = this.queue.delete.splice(0, 1000);

        try {
            if (createBatch.length > 0) {
                await this.manager.addDesiredListings(createBatch);
            }
            if (deleteBatch.length > 0) {
                await this.manager.removeDesiredListings(deleteBatch);
            }
        } catch (err) {
            // readd items to queue
            this.queue.create = createBatch.concat(this.queue.create);
            this.queue.delete = deleteBatch.concat(this.queue.delete);
        }
    }

    async init(callback) {
        if (this.ready) {
            callback(null);
            return null;
        }

        if (!this.steamid) {
            const err = new Error('Invalid / missing steamid64');
            callback(err);
            return err;
        }

        if (this.schema === null) {
            const err = new Error('Missing schema from tf2-schema');
            callback(err);
            return err;
        }

        try {
            await this.manager.addToken(this.token);
            await this.manager.refreshListingLimits();
            await this.manager.startAgent(this.userAgent);
            await this.manager.startInventoryRefresh();
        } catch (err) {
            callback(err);
            return err;
        }

        // TODO: only start refresh attempts when necessary
        this._updateInventoryInterval = setInterval(
            // interval time doesn't matter, bptf-manager will handle it
            this.manager.startInventoryRefresh.bind(this.manager),
            3 * 60 * 1000
        );

        this.ready = true;

        callback(null);
        return null;
    }

    createListings(listings: CreateListing[]) {
        if (!this.ready) {
            throw new Error('Module has not been successfully initialized');
        }

        const formattedArr = listings.map(value => this._formatListing(value)).filter(formatted => formatted !== null);

        const skuArr = formattedArr.map(formatted => formatted.sku);

        const removeDtoArr: RemoveListingDTO[] = [];
        const createDtoArr: CreateListingDTO[] = formattedArr.map((formatted, index) => {
            // sku should be undefined if we want multiple sell orders for the same item
            // eg. autobot sell item by id (!add id=assetid)
            if (formatted.intent === 1 && formatted.sku) {
                // if intent is sell, check if we already have a sell listing for sku
                // to make sure we don't create multiple sell listings for the same sku
                if (this.sellListings[formatted.sku] && formatted.id !== this.sellListings[formatted.sku]) {
                    if (!formatted.forceId) {
                        // change assetid to the id of the already exisiting listing
                        formatted.id = this.sellListings[formatted.sku];
                    } else {
                        removeDtoArr.push({ id: this.sellListings[formatted.sku] });
                    }
                }
            }

            delete formatted.sku;

            return {
                listing: formatted,
                priority: listings[index].priority,
                force: listings[index].force
            };
        });

        formattedArr.forEach((formatted, index) => {
            if (formatted.intent === 1 && formatted.id) {
                this.sellListings[skuArr[index]] = formatted.id;
            }
        });

        this.queue.delete.push(...removeDtoArr);
        this.queue.create.push(...createDtoArr);
    }

    /**
     * Enqueues a list of listings to be made
     * @param {Object} listing
     */
    createListing(listing: CreateListing) {
        return this.createListings([listing]);
    }

    getSellListingAssetid(sku: string) {
        return this.sellListings[sku] ?? null;
    }

    removeListings(listings: RemoveListing[]) {
        if (!this.ready) {
            throw new Error('Module has not been successfully initialized');
        }

        const formattedArr: RemoveListingDTO[] = listings.flatMap(listing => {
            if (listing.intent === 1) {
                const returnArr = [];
                if (listing.sku && this.sellListings[listing.sku]) {
                    returnArr.push({ id: this.sellListings[listing.sku] });
                }
                if (listing.id) {
                    returnArr.push({ id: listing.id });
                }
            }

            return { item: this._formatItem({ sku: listing.sku }) };
        });

        listings.forEach(listing => {
            if (listing.intent === 1 && listing.sku) {
                delete this.sellListings[listing.sku];
            }
        });

        this.queue.delete.push(...formattedArr);
    }

    /**
     * Enqueus a list of listings or listing ids to be removed
     * @param {Object} listing
     */
    removeListing(listing: RemoveListing) {
        this.removeListings([listing]);
    }

    async removeAllListings() {
        const listings = await this.manager.getDesiredListings();

        while (listings.length) {
            const batch = listings.splice(0, 1000);

            await this.manager.removeDesiredListings(batch.map(listing => ({ hash: listing.hash })));
        }

        this.sellListings = {};
    }

    _formatListing(listing: CreateListing) {
        let formatted: FormattedListing = { ...listing };
        if (listing.intent == 0) {
            if (listing.sku) {
                return null;
            }

            const item = this._formatItem({ sku: listing.sku });
            if (item === null) {
                return null;
            }
            formatted.item = item;

            if (listing.promoted !== undefined) {
                delete listing.promoted;
            }
            // Keep sku for later
        } else {
            if (listing.id === undefined) {
                return null;
            }
        }

        if (listing.offers === undefined) {
            formatted.offers = 1;
        }

        if (listing.buyout === undefined) {
            formatted.buyout = 1;
        }

        return formatted;
    }

    _formatItem(listing: { sku: string }): Record<string, unknown> {
        const item: Record<string, unknown> = SKU.fromString(listing.sku);

        const schemaItem = this.schema.getItemByDefindex(item.defindex as number);

        if (schemaItem === null) {
            return null;
        }

        // Begin formatting "item"

        const formatItem = {
            defindex: item.defindex,
            quality: item.quality
        };

        if (!item.craftable) {
            formatItem['flag_cannot_craft'] = true;
        }

        // Temporarily Disabled: https://github.com/TF2Autobot/tf2autobot/pull/1025#issuecomment-1100455637
        // const quantity = listing.quantity;
        // if (typeof quantity === 'number' && quantity > 0) {
        //     formatItem['quantity'] = quantity;
        // }

        formatItem['attributes'] = [];

        if (item.killstreak !== 0) {
            formatItem['attributes'].push({
                defindex: 2025,
                float_value: item.killstreak
            });
        }
        if (typeof item.killstreaker === 'number') {
            formatItem['attributes'].push({
                defindex: 2013,
                float_value: item.killstreak
            });
        }
        if (typeof item.sheen === 'number') {
            formatItem['attributes'].push({
                defindex: 2014,
                float_value: item.killstreak
            });
        }

        if (item.australium) {
            formatItem['attributes'].push({
                defindex: 2027
            });
        }

        if (item.festive) {
            formatItem['attributes'].push({
                defindex: 2053,
                float_value: 1
            });
        }

        if (item.effect) {
            if (schemaItem['item_slot'] === 'taunt') {
                formatItem['attributes'].push({
                    defindex: 2041,
                    value: item.effect
                });
            } else {
                formatItem['attributes'].push({
                    defindex: 134,
                    float_value: item.effect
                });
            }
        }

        if (item.quality2) {
            if (item.quality !== 11) {
                formatItem['attributes'].push({
                    defindex: 214
                });
            }
        }

        if (typeof item.paintkit === 'number') {
            formatItem['attributes'].push({
                defindex: 834,
                value: item.paintkit
            });
        }

        if (item.wear) {
            formatItem['attributes'].push({
                defindex: 725,
                float_value: (item.wear as number) / 5 // 0.2, 0.4, 0.6, 0.8, 1
            });
        }

        if (item.crateseries) {
            formatItem['attributes'].push({
                defindex: 187,
                float_value: item.crateseries
            });
        }

        if (item.craftnumber) {
            formatItem['attributes'].push({
                defindex: 229,
                value: item.craftnumber
            });
        }

        if (item.paint) {
            formatItem['attributes'].push({
                defindex: 142,
                float_value: item.paint
            });
        }

        if (item.output) {
            // https://github.com/TF2Autobot/tf2autobot/issues/995#issuecomment-1043044308

            // Collector's Chemistry Set
            // 20007;6;od-1085;oq-14
            // itemdef: od (item.output)
            // quality: oq (item.outputQuality)
            // No attributes

            // Strangifier Chemistry Set
            // 20005;6;td-343;od-6522;oq-6
            // itemdef: od (item.output)
            // quality: oq (item.outputQuality)
            // attributes[defindex=2012, float_value: td (item.target)]

            // Fabricator Kit:
            // Generic (Rare):
            // 20002;6;kt-2;od-6523;oq-6
            // itemdef: od (item.output)
            // quality: oq (item.outputQuality)
            // No attributes

            // Non-Generic:
            // 20003;6;kt-3;td-595;od-6526;oq-6
            // itemdef: od (item.output)
            // quality: oq (item.outputQuality)
            // attributes[defindex=2012, float_value: td (item.target)]

            const recipe = {
                defindex: 2000, // Just use 2000...
                is_output: true,
                quantity: 1,
                itemdef: item.output,
                quality: item.outputQuality || 6,
                attributes: []
            };

            if (item.target) {
                recipe.attributes.push({
                    defindex: 2012,
                    float_value: item.target
                });
            }

            if (item.sheen) {
                recipe.attributes.push({
                    defindex: 2014, //killstreak sheen
                    float_value: item.sheen
                });
            }
            if (item.killstreaker) {
                recipe.attributes.push({
                    defindex: 2013, //killstreak effect (for professional KS)
                    float_value: item.killstreaker
                });
            }

            if (recipe['attributes'].length === 0) {
                delete recipe['attributes'];
            }

            formatItem['attributes'].push(recipe);
        } else if (typeof item.target === 'number') {
            // Killstreak Kit, Strangifier, Unusualifier
            formatItem['attributes'].push({
                defindex: 2012,
                float_value: item.target
            });
        }

        //Spells
        if (typeof item.spell?.[1004] === 'number') {
            formatItem['attributes'].push({
                defindex: 1004,
                float_value: item.spell[1004]
            });
        }
        if (typeof item.spell?.[1005] === 'number') {
            formatItem['attributes'].push({
                defindex: 1005,
                float_value: item.spell[1005]
            });
        }
        if (item.spell?.[1006]) {
            formatItem['attributes'].push({
                defindex: 1006
            });
        }
        if (item.spell?.[1007]) {
            formatItem['attributes'].push({
                defindex: 1007
            });
        }
        if (item.spell?.[1008]) {
            formatItem['attributes'].push({
                defindex: 1008
            });
        }
        if (item.spell?.[1009]) {
            formatItem['attributes'].push({
                defindex: 1009
            });
        }

        //Strange parts
        if (item.parts?.[0]) {
            formatItem['attributes'].push({
                defindex: 380, //Strange PART 1
                float_value: item.parts?.[0]
            });
        }
        if (item.parts?.[1]) {
            formatItem['attributes'].push({
                defindex: 382, //Strange PART 2
                float_value: item.parts?.[1]
            });
        }
        if (item.parts?.[2]) {
            formatItem['attributes'].push({
                defindex: 384, //Strange PART 3
                float_value: item.parts?.[2]
            });
        }

        // TODO: Validate, test

        if (formatItem['attributes'].length === 0) {
            delete formatItem['attributes'];
        }

        return formatItem;
    }

    async shutdown() {
        clearInterval(this._updateInventoryInterval);
        clearInterval(this.handleQueueInterval);
        this.ready = false;

        await this.removeAllListings();
    }
}

interface ConstructorOptions {
    host: string;
    port: number;
    token: string;
    steamid: string;
    userAgent?: string;
    schema: SchemaManager.Schema;
}

export interface CreateListing {
    id?: string;
    sku?: string;
    intent: 0 | 1;
    quantity?: number;
    details?: string;
    promoted?: 0 | 1;
    currencies: TF2Currencies;
    offers?: 0 | 1;
    buyout?: 0 | 1;
    priority?: number;
    /** Force listing to be created even if it already exists */
    force?: boolean;
    /**
     * SELL ORDERS ONLY (intent === 1)
     * Force the given assetid to be used
     * Remove the old sell listing for the given sku if exists
     */
    forceId?: boolean;
}

interface FormattedListing extends CreateListing {
    item?: Record<string, unknown>;
}

export interface RemoveListing {
    id?: string;
    sku?: string;
    intent: 0 | 1;
}
