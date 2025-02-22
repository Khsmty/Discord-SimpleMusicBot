/*
 * Copyright 2021-2023 mtripg6666tdr
 * 
 * This file is part of mtripg6666tdr/Discord-SimpleMusicBot. 
 * (npm package name: 'discord-music-bot' / repository url: <https://github.com/mtripg6666tdr/Discord-SimpleMusicBot> )
 * 
 * mtripg6666tdr/Discord-SimpleMusicBot is free software: you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free Software Foundation, 
 * either version 3 of the License, or (at your option) any later version.
 *
 * mtripg6666tdr/Discord-SimpleMusicBot is distributed in the hope that it will be useful, 
 * but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. 
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with mtripg6666tdr/Discord-SimpleMusicBot. 
 * If not, see <https://www.gnu.org/licenses/>.
 */

import type { exportableStatuses } from ".";
import type { YmxFormat } from "../../Structure";
import type { DataType, MusicBotBase } from "../../botBase";

import candyget from "candyget";
import PQueue from "p-queue";

import { IntervalBackupper } from ".";
import { timeLoggedMethod } from "../../logger";

export class ReplitBackupper extends IntervalBackupper {
  protected readonly db: ReplitClient = null;

  static get backuppable(){
    return process.env.DB_URL?.startsWith("replit+http");
  }

  constructor(bot: MusicBotBase, getData: () => DataType){
    super(bot, getData, "Replit");

    this.db = new ReplitClient(process.env.DB_URL.substring("replit+".length));

    this.bot.client.on("guildDelete", ({ id }) => {
      Promise.allSettled([
        this.db.delete(this.getDbKey("status", id)),
        this.db.delete(this.getDbKey("queue", id)),
      ]).catch(this.logger.error);
    });
  }

  @timeLoggedMethod
  protected override async backupStatus(){
    if(!this.db) return;

    // determine which data should be backed up
    const filteredGuildIds = this.getStatusModifiedGuildIds();

    // execute
    for(let i = 0; i < filteredGuildIds.length; i++){
      const guildId = filteredGuildIds[i];
      try{
        this.logger.info(`Backing up status...(${guildId})`);
        const currentStatus = this.data.get(guildId).exportStatus();
        await this.db.set(this.getDbKey("status", guildId), currentStatus);
        this.updateStatusCache(guildId, currentStatus);
      }
      catch(er){
        this.logger.error(er);
        this.logger.info("Something went wrong while backing up status");
      }
    }
  }

  @timeLoggedMethod
  protected override async backupQueue(){
    if(!this.db) return;
    const modifiedGuildIds = this.getQueueModifiedGuildIds();
    for(let i = 0; i < modifiedGuildIds.length; i++){
      const guildId = modifiedGuildIds[i];
      try{
        this.logger.info(`Backing up queue...(${guildId})`);
        await this.db.set(this.getDbKey("queue", guildId), this.data.get(guildId).exportQueue());
        this.unmarkQueueModifiedGuild(guildId);
      }
      catch(er){
        this.logger.error(er);
        this.logger.info("Something went wrong while backing up queue");
      }
    }
  }

  @timeLoggedMethod
  override async getQueueDataFromBackup(guildIds: string[]): Promise<Map<string, YmxFormat>> {
    const result = new Map<string, YmxFormat>();
    try{
      await Promise.all(
        guildIds.map(async id => {
          const queue = await this.db.get<YmxFormat>(this.getDbKey("queue", id));
          if(queue){
            result.set(id, queue);
          }
        })
      );
      return result;
    }
    catch(er){
      this.logger.error(er);
      this.logger.error("Queue restoring failed!");
      return null;
    }
  }

  @timeLoggedMethod
  override async getStatusFromBackup(guildIds: string[]): Promise<Map<string, exportableStatuses>> {
    const result = new Map<string, exportableStatuses>();
    try{
      await Promise.all(
        guildIds.map(async id => {
          const status = await this.db.get<exportableStatuses>(this.getDbKey("status", id));
          if(status){
            result.set(id, status);
            this.updateStatusCache(id, status);
          }
        })
      );
      return result;
    }
    catch(er){
      this.logger.error(er);
      this.logger.error("Status restoring failed!");
      return null;
    }
  }

  private getDbKey(type: "status" | "queue", guildId: string){
    return `dsmb-${type === "status" ? "s" : "q"}-${guildId}`;
  }

  override destroy(){
  }
}

class ReplitClient {
  protected baseUrl: string;
  protected queue: PQueue;

  constructor(baseUrl?: string){
    this.baseUrl = baseUrl;
    if(baseUrl === "local" || !this.baseUrl){
      this.baseUrl = process.env.REPLIT_DB_URL;
    }

    if(!this.baseUrl){
      throw new Error("No URL found");
    }

    this.queue = new PQueue({
      concurrency: 3,
      timeout: 10e3,
      throwOnTimeout: true,
      intervalCap: 4,
      interval: 10,
    });
  }

  get(key: string, options: { raw: true }): Promise<string>;
  get<T = any>(key: string, options?: { raw: false }): Promise<T>;
  get<T = any>(key: string, options?: { raw: boolean }){
    return this.queue.add(async () => {
      const shouldRaw = options?.raw || false;
      const { body } = await candyget(`${this.baseUrl}/${key}`, "string");
      if(!body){
        return null;
      }else if(shouldRaw){
        return body;
      }else{
        return JSON.parse(body) as T;
      }
    });
  }

  set(key: string, value: any){
    return this.queue.add(async () => {
      const textData = JSON.stringify(value);

      const { statusCode } = await candyget.post(this.baseUrl, "empty", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }, `${encodeURIComponent(key)}=${encodeURIComponent(textData)}`);

      if(statusCode >= 200 && statusCode <= 299){
        return this;
      }else{
        throw new Error(`Status code: ${statusCode}`);
      }
    });
  }

  delete(key: string){
    return this.queue.add(async () => {
      await candyget.delete(`${this.baseUrl}/${key}`, "empty");
      return this;
    });
  }
}
