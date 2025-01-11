import * as dotenv from 'dotenv';
import {Telegraf} from "telegraf";
import {message} from "telegraf/filters";
import {User} from "./types/user.type";
import {MsgGeneratorService} from "./services/msg-generator.service";
import OpenAI from "openai";
import axios from "axios";
import * as fs from "node:fs";
import { v4 as uuidv4 } from 'uuid';
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static"

dotenv.config();

const AUDIO_FOLDER = path.join(__dirname, "..", "wwwroot");
const MAX_AUDIO_DURATION = 10 * 60;

ffmpeg.setFfmpegPath(ffmpegPath as string);

const openAi = new OpenAI({apiKey: process.env.API_KEY});

const allowedUsers = JSON.parse(process.env.ALLOWED_USERS as string) as User[];
const bot = new Telegraf(process.env.BOT_TOKEN as string);

bot.on(message("text"), ctx => {
    const fromTgId = ctx.message.from.id;
    const user = allowedUsers.find(x => x.tgId == fromTgId);
    if (user == null) {
        ctx.reply(MsgGeneratorService.generateYouNotAuthMsg());
    } else {
        ctx.reply(MsgGeneratorService.generateWelcomeMsg(user.name));
    }
});

bot.on(message("audio"), async ctx => {

    let pathToOriginalFile: string | null = null;
    let chunksDir: string | null = null;

    try {
        const mimeType = ctx.message.audio.mime_type;
        if (mimeType != "audio/mpeg") {
            await ctx.reply("support only mp3 file format");
            return;
        }

        const fileId = ctx.message.audio.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const fileName = uuidv4() + ".mp3";

        pathToOriginalFile = path.join(AUDIO_FOLDER, fileName)

        await downloadFile(fileLink.toString(), pathToOriginalFile);

        chunksDir = path.join(AUDIO_FOLDER, uuidv4());
        const chunks = (await splitAudio(pathToOriginalFile, chunksDir)) as string[];

        let transcriptions = "";

        await ctx.reply("Processing..");

        for (const item of chunks) {
            const result = await openAi.audio.transcriptions.create({
                file: fs.createReadStream(item),
                model: "whisper-1",
                response_format: "text",
            });

            transcriptions += result;
        }

        await ctx.reply(transcriptions);
    } catch (e){
        console.log("Error - ", e);
        await ctx.reply("Internal server error, please contact with @elizabethcrack")
    } finally {
        if (pathToOriginalFile != null) {
            fs.rmSync(pathToOriginalFile, {force: true});
        }

        if (chunksDir != null){
            fs.rmSync(chunksDir, {recursive: true, force: true});
        }
    }
})

async function downloadFile(url: string, path: string) {
    const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
    });

    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(path);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function splitAudio(filePath: string, outputDir: string) {
    fs.mkdirSync(outputDir, {recursive: true});

    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) reject(err);

            const duration = metadata.format.duration as number;
            const promises = [];

            for (let startTime = 0; startTime < duration; startTime += MAX_AUDIO_DURATION) {
                const outputFile = path.join(outputDir, `chunk_${startTime}.mp3`);
                promises.push(
                    new Promise((res, rej) => {
                        ffmpeg(filePath)
                            .setStartTime(startTime)
                            .setDuration(Math.min(MAX_AUDIO_DURATION, duration - startTime))
                            .output(outputFile)
                            .on('end', () => res(outputFile))
                            .on('error', rej)
                            .run();
                    })
                )
            }

            Promise.all(promises)
                .then(files => resolve(files))
                .catch(reject);
        })
    })
}

bot.launch();
