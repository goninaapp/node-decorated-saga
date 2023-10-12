import { Client } from 'pg';
import { Signer } from 'aws-sdk/clients/rds';
import axios from 'axios';
import { ConnectionOptions } from 'tls';
import debugg from 'debug';

const error = debugg('error');

export class Database {
  private client?: Client;
  private readonly host: string;
  private readonly port: number;
  private readonly database: string;
  private readonly username: string;
  private readonly region: string;

  constructor(
    host: string,
    port: number,
    database: string,
    username?: string,
    region?: string,
  ) {
    username = username || 'postgres';

    region =
      process.env.AWS_DEFAULT_REGION ||
      process.env.AWS_REGION ||
      region ||
      'eu-central-1';

    this.host = host;
    this.port = port;
    this.database = database;
    this.username = username;
    this.region = region;

    this.connect().catch(error);
  }

  public async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    try {
      await this.connect();
    } catch (e) {
      error(e);

      throw new Error('could not connect to database');
    }

    if (!this.client) {
      throw new Error('Could not connect to database');
    }

    return this.client;
  }

  private async connect() {
    const signer = new Signer({
      region: this.region,
    });

    const password = signer.getAuthToken({
      hostname: this.host,
      port: this.port,
      username: this.username,
    });

    const cl = new Client({
      host: this.host,
      port: this.port,
      database: this.database,
      user: this.username,
      password,
      ssl: {
        rejectUnauthorized: false,
      },
      connectionTimeoutMillis: 3000,
      query_timeout: 3000,
    });

    await cl.connect();

    this.client = cl;
    this.client.on('end', () => {
      console.log('db closed');
      this.client = undefined;
    });
  }
}
