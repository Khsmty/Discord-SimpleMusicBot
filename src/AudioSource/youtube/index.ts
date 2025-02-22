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

import type { Cache } from "./strategies/base";
import type { StreamInfo } from "..";
import type { i18n } from "i18next";
import type { EmbedField } from "oceanic.js";
import type { InfoData } from "play-dl";

import * as ytdl from "ytdl-core";

import { attemptGetInfoForStrategies, attemptFetchForStrategies } from "./strategies";
import { playDl } from "./strategies/play-dl";
import { ytdlCore } from "./strategies/ytdl-core";
import { SecondaryUserAgent } from "../../definition";
import { timeLoggedMethod } from "../../logger";
import { AudioSource } from "../audiosource";

export * from "./spawner";

export class YouTube extends AudioSource<string> {
  // サービス識別子（固定）
  protected cache: Cache<any, any> = null;
  protected channelName: string;
  protected channelUrl: string;
  protected upcomingTimestamp: string = null;

  protected _strategyId: number;
  get strategyId(){
    return this._strategyId;
  }
  protected set strategyId(value: number){
    this._strategyId = value;
  }

  protected _isLiveStream: boolean;
  get isLiveStream(){
    return this._isLiveStream;
  }
  protected set isLiveStream(value: boolean){
    this._isLiveStream = value;
  }

  _relatedVideos: readonly exportableYouTube[] = [];
  get relatedVideos(): readonly exportableYouTube[] {
    return this._relatedVideos;
  }
  protected set relatedVideos(value: readonly exportableYouTube[]){
    this._relatedVideos = value;
  }

  constructor(){
    super("youtube");
  }

  get isFallbacked(){
    return typeof this.strategyId === "number" && this.strategyId !== 0 && this.strategyId !== 1;
  }

  get isCached(){
    return !!this.cache;
  }

  get availableAfter(){
    return this.upcomingTimestamp;
  }

  @timeLoggedMethod
  async init(url: string, prefetched: exportableYouTube, _: i18n["t"], forceCache?: boolean){
    this.url = "https://www.youtube.com/watch?v=" + ytdl.getVideoID(url);
    if(prefetched){
      this.importData(prefetched);
    }else{
      const { result, resolved } = await attemptGetInfoForStrategies(url);

      // check if fallbacked
      this.strategyId = resolved;

      // check if upcoming
      if(result.cache?.data){
        if(
          "videoDetails" in result.cache.data
          && result.cache.data.videoDetails.liveBroadcastDetails
          && result.cache.data.videoDetails.liveBroadcastDetails.startTimestamp
          && !result.cache.data.videoDetails.liveBroadcastDetails.isLiveNow
          && !result.cache.data.videoDetails.liveBroadcastDetails.endTimestamp
        ){
          this.upcomingTimestamp = result.cache.data.videoDetails.liveBroadcastDetails.startTimestamp;
        }else if(
          "LiveStreamData" in result.cache.data
          && result.cache.data.LiveStreamData.isLive
          && result.cache.data.video_details.upcoming
          && typeof result.cache.data.video_details.upcoming === "object"
        ){
          this.upcomingTimestamp = result.cache.data.video_details.upcoming.toISOString();
        }else{
          this.upcomingTimestamp = null;
        }
      }

      // store data as cache if requested
      if(forceCache) this.cache = result.cache;

      // import data to the current instance
      this.importData(result.data);
    }
    return this;
  }

  @timeLoggedMethod
  async fetch(forceUrl?: boolean): Promise<StreamInfo>{
    const { result, resolved } = await attemptFetchForStrategies(this.url, forceUrl, this.cache);
    this.strategyId = resolved;
    // store related videos
    this.relatedVideos = result.relatedVideos;
    this.importData(result.info);
    if(forceUrl){
      this.logger.info("Returning a url instead of stream");
    }

    if(result.cache){
      this.cache = result.cache;
    }

    return result.stream;
  }

  async fetchVideo(){
    if(this.cache?.type === ytdlCore){
      const info = this.cache.data as ytdl.videoInfo;
      const isLive = info.videoDetails.liveBroadcastDetails && info.videoDetails.liveBroadcastDetails.isLiveNow;
      const format = ytdl.chooseFormat(info.formats, {
        quality: isLive ? null : "highestvideo",
        isHLS: isLive,
      } as ytdl.chooseFormatOptions);
      const { url } = format;
      return {
        url,
        ua: SecondaryUserAgent,
      };
    }else if(this.cache?.type === playDl){
      const info = this.cache.data as InfoData;
      const format = info.format.filter(f => f.mimeType.startsWith("video")).sort((a, b) => b.bitrate - a.bitrate)[0];
      const url = format.url || info.LiveStreamData.hlsManifestUrl;

      if(!url){
        throw new Error("No url found.");
      }

      return {
        url,
        ua: SecondaryUserAgent,
      };
    }else{
      throw new Error("No available data found.");
    }
  }

  toField(verbose: boolean, t: i18n["t"]){
    const fields = [] as EmbedField[];
    fields.push({
      name: `:cinema:${t("channelName")}`,
      value: this.channelUrl ? `[${this.channelName}](${this.channelUrl})` : this.channelName,
      inline: false,
    }, {
      name: `:asterisk:${t("summary")}`,
      value: this.description.length > (verbose ? 1000 : 350)
        ? this.description.substring(0, verbose ? 1000 : 300) + "..."
        : this.description || `*${t("noSummary")}*`,
      inline: false,
    });
    return fields;
  }

  npAdditional(t: i18n["t"]){
    return `${t("channelName")}:\`${this.channelName}\``;
  }

  exportData(): exportableYouTube{
    return {
      url: this.url,
      title: this.title,
      description: this.description,
      length: this.lengthSeconds,
      channel: this.channelName,
      channelUrl: this.channelUrl,
      thumbnail: this.thumbnail,
      isLive: this.isLiveStream,
    };
  }

  private importData(exportable: exportableYouTube){
    this.title = exportable.title;
    this.description = exportable.description || "";
    this.lengthSeconds = exportable.isLive ? NaN : exportable.length;
    this.channelName = exportable.channel;
    this.channelUrl = exportable.channelUrl;
    this.thumbnail = exportable.thumbnail;
    this.isLiveStream = exportable.isLive;
  }

  override purgeCache(){
    this.cache = null;
  }

  waitForLive(signal: AbortSignal, tick: () => void){
    if(!this.availableAfter){
      throw new Error("This is not a live stream");
    }

    return new Promise<void>(resolve => {
      let timeout: NodeJS.Timeout = null;
      signal.addEventListener("abort", () => {
        if(timeout){
          clearTimeout(timeout);
          resolve();
        }
      }, { once: true });
      const checkForLive = () => {
        if(signal.aborted) return;

        tick();

        const startTime = this.availableAfter;
        if(!startTime){
          resolve();
        }

        const waitTime = Math.max(new Date(startTime).getTime() - Date.now(), 20 * 1000);
        this.logger.info(`Retrying after ${waitTime}ms`);

        timeout = setTimeout(async () => {
          if(signal.aborted) return;
          tick();
          this.purgeCache();
          await this.init(this.url, null, null, false);
          checkForLive();
        }, waitTime).unref();
      };
      checkForLive();
    });
  }
}

export type exportableYouTube = {
  url: string,
  title: string,
  description: string,
  length: number,
  channel: string,
  channelUrl: string,
  thumbnail: string,
  isLive: boolean,
};
