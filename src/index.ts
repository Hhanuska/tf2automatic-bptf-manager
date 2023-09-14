import SchemaManager from '@tf2autobot/tf2-schema';
import { Manager } from './classes/manager';

export class ListingManager {
    private manager: Manager;

    private steamid: string;

    private token: string;

    private userAgent: string;

    private schema: SchemaManager.Schema;

    public ready = false;

    private _updateInventoryInterval: ReturnType<typeof setInterval>;

    constructor(options: ConstructorOptions) {
        this.steamid = options.steamid;
        this.token = options.token;
        this.userAgent = options.userAgent;
        this.schema = options.schema;

        this.manager = new Manager(`http://${options.host}:${options.port}`, this.steamid);
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
}

interface ConstructorOptions {
    host: string;
    port: number;
    token: string;
    steamid: string;
    userAgent?: string;
    schema: SchemaManager.Schema;
}
