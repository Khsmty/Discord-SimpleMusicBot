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

import type { CommandArgs } from ".";
import type { CommandMessage } from "../Component/commandResolver/CommandMessage";
import type { YmxFormat } from "../Structure";
import type { i18n } from "i18next";
import type { AnyGuildTextChannel, Message } from "oceanic.js";

import candyget from "candyget";
import { ApplicationCommandTypes } from "oceanic.js";

import { BaseCommand } from ".";
import { TaskCancellationManager } from "../Component/TaskCancellationManager";
import { YmxVersion } from "../Structure";
import { useConfig } from "../config";

const config = useConfig();

export default class Import extends BaseCommand {
  constructor(){
    super({
      alias: ["import"],
      unlist: false,
      category: "playlist",
      argument: [{
        type: "string",
        name: "url",
        required: true,
      }],
      requiredPermissionsOr: ["admin", "noConnection", "sameVc"],
      shouldDefer: false,
      usage: true,
      examples: true,
      messageCommand: true,
    });
  }

  async run(message: CommandMessage, context: CommandArgs, t: i18n["t"]){
    context.server.updateBoundChannel(message);

    const statusMessage = await message.reply(`🔍${t("commands:import.loadingMessage")}...`);
    let targetMessage: Message<AnyGuildTextChannel> = null;
    if(message["_interaction"] && "type" in message["_interaction"].data && message["_interaction"].data.type === ApplicationCommandTypes.MESSAGE){
      targetMessage = message["_interaction"].data.resolved.messages.first() as Message<AnyGuildTextChannel>;
      if(targetMessage.author?.id !== context.client.user.id){
        await statusMessage.edit(`❌${t("commands:import.notBotMessage")}`);
        return;
      }
    }else{
      if(context.rawArgs === ""){
        message.reply(`❓${t("commands:import.invalidArgumentMessage")}`).catch(this.logger.error);
        return;
      }
      let force = false;
      let url = context.rawArgs;
      if(context.args.length >= 2 && context.args[0] === "force" && config.isBotAdmin(message.member.id)){
        force = true;
        url = context.args[1];
      }
      if(!url.startsWith("http://discord.com/channels/") && !url.startsWith("https://discord.com/channels/")){
        await message.reply(`❌${t("commands:import.noDiscordLink")}`).catch(this.logger.error);
        return;
      }

      const ids = url.split("/");
      if(ids.length < 2){
        await message.reply(`🔗${t("commands:import.invalidLink")}`);
        return;
      }

      try{
        // get the message
        const targetChannelId = ids[ids.length - 2];
        const targetMessageId = ids[ids.length - 1];
        const channel = await context.client.rest.channels.get<AnyGuildTextChannel>(targetChannelId);
        targetMessage = channel.guild && await channel.getMessage(targetMessageId);
        if(targetMessage.author?.id !== context.client.user.id && !force){
          await statusMessage.edit(`❌${t("commands:import.notBotMessage")}`);
          return;
        }
      }
      catch(e){
        this.logger.error(e);
        statusMessage?.edit(`:sob:${t("failed")}...`).catch(this.logger.error);
      }
    }

    const cancellation = context.server.bindCancellation(new TaskCancellationManager());
    try{
      // extract an embed and an attachment
      const attac = targetMessage.attachments.size > 0 ? targetMessage.attachments.first() : null;

      if(attac && attac.filename.endsWith(".ymx")){
        // if an attachment is ymx
        const raw = await candyget.json(attac.url).then(({ body }) => body) as YmxFormat;

        if(raw.version !== YmxVersion){
          await statusMessage.edit(
            `✘${
              t("commands:import.versionIncompatible")
            }(${t("commands:import.current")}:v${YmxVersion}; ${t("commands:import.file")}:v${raw.version})`);
          return;
        }

        const qs = raw.data;
        for(let i = 0; i < qs.length; i++){
          await context.server.queue.addQueueOnly({
            url: qs[i].url,
            addedBy: message.member,
            gotData: qs[i],
          });
          if(qs.length <= 10 || i % 10 === 9){
            await statusMessage.edit(
              t("songProcessingInProgress", {
                totalSongCount: t("totalSongCount", { count: qs.length }),
                currentSongCount: t("currentSongCount", { count: i + 1 }),
              })
            );
          }
          if(cancellation.Cancelled) break;
        }

        if(!cancellation.Cancelled){
          await statusMessage.edit(`✅${t("songProcessingCompleted", { count: qs.length })}`);
        }else{
          await statusMessage.edit(`✅${t("canceled")}`);
        }
      }else{
        await statusMessage.edit(`❌${t("commands:import.contentNotIncludedInMessage")}`);
        return;
      }
    }
    catch(e){
      this.logger.error(e);
      statusMessage?.edit(`:sob:${t("failed")}...`).catch(this.logger.error);
    }
    finally{
      context.server.unbindCancellation(cancellation);
    }
  }
}
