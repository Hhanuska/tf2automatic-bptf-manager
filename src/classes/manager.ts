import axios, { AxiosInstance } from 'axios';
import TF2Currencies from '@tf2autobot/tf2-currencies';

export class Manager {
    private axios: AxiosInstance;

    constructor(private url: string, private steamid: string) {
        this.axios = axios.create({
            baseURL: this.url
        });
    }

    async healthCheck(): Promise<string> {
        return (
            await this.axios({
                method: 'GET',
                url: '/metrics'
            })
        ).data;
    }

    async addToken(token: string): Promise<void> {
        return (
            await this.axios({
                method: 'POST',
                url: '/tokens',
                data: {
                    steamid64: this.steamid,
                    value: token
                }
            })
        ).data;
    }

    async startAgent(agent: string): Promise<{ steamid64: string; userAgent: string | null; updatedAt: number }> {
        return (
            await this.axios({
                method: 'POST',
                url: `/agents/${this.steamid}/register`,
                data: {
                    userAgent: agent
                }
            })
        ).data;
    }

    async stopAgent(): Promise<void> {
        return (
            await this.axios({
                method: 'POST',
                url: `/agents/${this.steamid}/unregister`
            })
        ).data;
    }

    async startInventoryRefresh(): Promise<void> {
        return (
            await this.axios({
                method: 'POST',
                url: `/inventories/${this.steamid}/refresh`
            })
        ).data;
    }

    async refreshListingLimits(): Promise<void> {
        return (
            await this.axios({
                method: 'POST',
                url: `/listings/${this.steamid}/limits/refresh`
            })
        ).data;
    }

    async getListingLimits(): Promise<{ cap: number; used: number; promoted: number; updatedAt: number }> {
        return (
            await this.axios({
                method: 'GET',
                url: `/listings/${this.steamid}/limits`
            })
        ).data;
    }

    async addDesiredListings(listings: CreateListingDTO[]): Promise<DesiredListing[]> {
        return (
            await this.axios({
                method: 'POST',
                url: `/listings/${this.steamid}/desired`,
                data: listings
            })
        ).data;
    }

    async removeDesiredListings(listings: RemoveListingDTO[]): Promise<void> {
        return (
            await this.axios({
                method: 'DELETE',
                url: `/listings/${this.steamid}/desired`,
                data: listings
            })
        ).data;
    }

    async getDesiredListings(): Promise<DesiredListing[]> {
        return (
            await this.axios({
                method: 'GET',
                url: `/listings/${this.steamid}/desired`
            })
        ).data;
    }
}

export type RemoveListingDTO =
    | {
          hash: string;
      }
    | {
          id: string;
      }
    | {
          item: Record<string, unknown>;
      };

export interface CreateListingDTO {
    listing: BpCreateListingDTO;
    priority?: number;
    force?: boolean;
}

export type BpCreateListingDTO = {
    currencies: TF2Currencies;
    intent: 0 | 1;
    offers?: 0 | 1;
    buyout?: 0 | 1;
    promoted?: 0 | 1;
    details?: string;
    id?: string;
    item?: Record<string, unknown>;
};

export type DesiredListing = {
    hash: string;
    id: string | null;
    updatedAt: number;
    lastAttemptedAt?: number;
    error?: string;
} & CreateListingDTO;
