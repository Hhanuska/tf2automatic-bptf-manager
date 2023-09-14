import SchemaManager from '@tf2autobot/tf2-schema';

export class ListingManager {
    private steamid: string;

    private token: string;

    constructor(options: ConstructorOptions) {
        this.steamid = options.steamid;
        this.token = options.token;
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
