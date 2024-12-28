const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const sharp = require('sharp'); // For image processing
const ffmpeg = require('fluent-ffmpeg'); // For video/GIF processing
const fs = require('fs'); // For handling file system
require('dotenv').config();
const axios = require('axios'); 
const path = require('path'); // For handling file paths
const ytdl = require('ytdl-core'); // YouTube downloader
const { exec } = require('child_process'); // To run spotdl command
const youtubedl = require('youtube-dl-exec');
const JIKAN_API_URL = process.env.JIKAN_API_URL;

// Initialize WhatsApp client
client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox'],
        timeout: 120000, // Increase timeout to 120 seconds
    }
});

// Command prefix and cooldown settings
const prefix = "!";
const lastCommandTime = new Map();
const cooldown = 5000; // 5 seconds

// Helper function to check cooldown
function isOnCooldown(msg) {
    const currentTime = Date.now();
    const lastTime = lastCommandTime.get(msg.from) || 0;
    if (currentTime - lastTime < cooldown) {
        const remainingTime = ((cooldown - (currentTime - lastTime)) / 1000).toFixed(1);
        client.sendMessage(msg.from, `Please wait ${remainingTime} more seconds before sending another command.`);
        return true;
    }
    lastCommandTime.set(msg.from, currentTime);
    return false;
}

const musicFolderPath = 'C:\\BOT\\temp'; // Change to the 'spotify' directory
if (!fs.existsSync(musicFolderPath)) 
    fs.mkdirSync(musicFolderPath, { recursive: true }); // Create the directory

const tempDir = 'C:\\BOT\\temp';
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Helper function to get the list of music files
function getMusicFiles() {
    try {
        return fs.readdirSync(musicFolderPath).filter(file => file.endsWith('.mp3') || file.endsWith('.wav'));
    } catch (err) {
        console.error('Error reading music folder:', err);
        return [];
    }
}

// Helper function to download and process media
async function downloadMedia(msg) {
    let mediaMsg = msg;
    if (!msg.hasMedia && msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        if (quotedMsg.hasMedia) {
            mediaMsg = quotedMsg;
        }
    }
    if (mediaMsg.hasMedia) {
        const mediaData = await mediaMsg.downloadMedia();
        if (!mediaData) {
            await client.sendMessage(msg.from, "Failed to download media.");
            return null;
        }
        return mediaData;
    }
    await client.sendMessage(msg.from, "No media found in the message.");
    return null;
}

// Process image for sticker creation
async function processImageSticker(mediaData, textToOverlay = "Sticker", msg) {
    const imgBuffer = Buffer.from(mediaData.data, 'base64');
    const processedImgPath = `./temp/processed-sticker.png`;

    await sharp(imgBuffer)
        .resize(512, 512)
        .composite([{
            input: Buffer.from(`
                <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
                    <text x="50%" y="50%" font-size="32" fill="white" fill-opacity="0.5" text-anchor="middle" dominant-baseline="middle">
  ${textToOverlay}
</text>
                </svg>
            `),
            top: 0,
            left: 0
        }])
        .png()
        .toFile(processedImgPath);

    const processedMedia = MessageMedia.fromFilePath(processedImgPath);
    await client.sendMessage(msg.from, processedMedia, { sendMediaAsSticker: true });
    fs.unlinkSync(processedImgPath);
}

// Process GIF or video for sticker creation
function processGifOrVideoSticker(mediaData, msg) {
    const mediaBuffer = Buffer.from(mediaData.data, 'base64');
    const inputMediaPath = './temp/input-media.mp4'; // General path for input media (can be GIF or video)
    const outputStickerPath = './temp/output-sticker.webp';

    // Write media buffer to input path
    fs.writeFileSync(inputMediaPath, mediaBuffer);

    // Start FFmpeg conversion (whether GIF or video, it should handle both cases)
    ffmpeg(inputMediaPath)
        .outputOptions([
            '-vcodec', 'libwebp',
            '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=white',
            '-lossless', '1',
            '-loop', '0',
            '-ss', '0',
            '-t', '6', // Limit to 6 seconds for GIFs or short videos
            '-preset', 'default',
            '-an',
            '-vsync', '0'
        ])
        .save(outputStickerPath)
        .on('end', async () => {
            console.log('FFmpeg: GIF/video conversion completed.');

            if (fs.existsSync(outputStickerPath)) {
                const stickerMedia = MessageMedia.fromFilePath(outputStickerPath);
                try {
                    await client.sendMessage(msg.from, stickerMedia, { sendMediaAsSticker: true });
                    console.log('Sticker sent successfully!');
                } catch (sendError) {
                    console.error('Error sending sticker:', sendError);
                }

                fs.unlinkSync(inputMediaPath);
                fs.unlinkSync(outputStickerPath);
            } else {
                console.error('Output file not found after FFmpeg conversion.');
                await client.sendMessage(msg.from, "Error: Sticker conversion failed.");
            }
        })
        .on('error', async (err) => {
            console.error('FFmpeg error during GIF/video conversion:', err);
            await client.sendMessage(msg.from, "Failed to process GIF/video.");
        });
}

async function downloadSpotifySong(url, msg) {
    return new Promise((resolve, reject) => {
        const spotdlCommand = `spotdl ${url} --output "${musicFolderPath}"`;

        exec(spotdlCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error downloading Spotify track: ${error.message}`);
                reject(new Error('Failed to download Spotify track.'));
                return;
            }

            console.log('SpotDL stdout:', stdout);  // Log stdout for debugging
            console.error('SpotDL stderr:', stderr);  // Log stderr for debugging

            setTimeout(() => {
                const filesInDirectory = fs.readdirSync(musicFolderPath);
                console.log('Files in directory:', filesInDirectory); // Log files

                const downloadedFile = filesInDirectory
                    .filter(file => file.endsWith('.mp3'))
                    .sort((a, b) => fs.statSync(path.join(musicFolderPath, b)).mtime - fs.statSync(path.join(musicFolderPath, a)).mtime)[0];  // Get the most recently modified file

                if (downloadedFile) {
                    const actualFilePath = path.join(musicFolderPath, downloadedFile);
                    const musicFileBuffer = fs.readFileSync(actualFilePath);
                    const musicMedia = new MessageMedia('audio/mpeg', musicFileBuffer.toString('base64'), path.basename(actualFilePath));

                    client.sendMessage(msg.from, musicMedia).then(() => {
                        // fs.unlinkSync(actualFilePath); // Comment this to avoid deleting
                        resolve();
                    }).catch(err => {
                        console.error('Error sending the Spotify track:', err);
                        reject(new Error('Failed to send the Spotify track.'));
                    });
                } else {
                    reject(new Error('Failed to find the downloaded song.'));
                }
            }, 5000);
        });
    });
}

const downloadYouTubeMedia = async (url, msg, format) => {
    return new Promise((resolve, reject) => {
        // Set output path based on format
        const outputPath = format === 'mp4' ? 
            path.join(tempDir, 'youtube_video.mp4') : 
            path.join(tempDir, 'youtube_audio.mp3');

        // Define the yt-dlp command based on the requested format
        const ytDlpCommand = `yt-dlp "${url}" --output "${outputPath}" ${format === 'mp3' ? '--extract-audio --audio-format mp3' : '--format bestvideo+bestaudio'} --restrict-filenames`;

        exec(ytDlpCommand, async (error, stdout, stderr) => {
            if (error) {
                console.error('Error downloading or sending YouTube', format, ':', error);
                
                // If there's an error, try downloading as .webm
                console.log("Attempting to download as .webm format due to error.");
                try {
                    await downloadAndConvertWebm(url, msg);
                    resolve();
                } catch (webmError) {
                    reject(new Error(`Error downloading YouTube video in both ${format} and webm: ${webmError.message}`));
                }
                return;
            }

            console.log('yt-dlp stdout:', stdout);
            console.error('yt-dlp stderr:', stderr);

            // After download completes, look for the file in the temp directory
            setTimeout(() => {
                fs.readdir(tempDir, (err, files) => {
                    if (err) {
                        console.error('Error reading directory:', err);
                        reject(new Error('Failed to read temp directory.'));
                        return;
                    }

                    // Filter to get the first file found
                    const fileToSend = files.find(file => {
                        const filePath = path.join(tempDir, file);
                        return fs.statSync(filePath).isFile(); // Check if it is a file
                    });

                    if (!fileToSend) {
                        console.error('No files found in temp directory.');
                        reject(new Error('No files to send.'));
                        return;
                    }

                    const filePathToSend = path.join(tempDir, fileToSend);
                    console.log(`Attempting to send file: ${filePathToSend}`);
                    
                    const media = MessageMedia.fromFilePath(filePathToSend);

                    client.sendMessage(msg.from, media).then(() => {
                        console.log(`Sent file: ${fileToSend} successfully.`);
                        
                        // Remove the file after successful sending
                        fs.unlink(filePathToSend, (unlinkErr) => {
                            if (unlinkErr) {
                                console.error(`Error deleting file: ${filePathToSend}`, unlinkErr);
                            } else {
                                console.log(`Deleted file: ${filePathToSend}`);
                            }
                        });
                        resolve();
                    }).catch(err => {
                        console.error('Error sending the file:', err);
                        reject(new Error('Failed to send the file.'));
                    });
                });
            }, 1000); // Timeout to allow file operations to complete
        });
    });
};

// Function to download and convert .webm files to .mp4
const downloadAndConvertWebm = async (url, msg) => {
    return new Promise((resolve, reject) => {
        const webmOutputPath = path.join(tempDir, 'youtube_video.webm');
        const ytDlpCommand = `yt-dlp "${url}" --output "${webmOutputPath}" --format webm --restrict-filenames`;

        exec(ytDlpCommand, async (error, stdout, stderr) => {
            if (error) {
                console.error('Error downloading YouTube video in webm format:', error);
                reject(new Error('Failed to download YouTube video in webm format.'));
                return;
            }

            console.log('yt-dlp stdout:', stdout);
            console.error('yt-dlp stderr:', stderr);

            try {
                const mp4FilePath = await convertWebmToMp4(webmOutputPath);
                
                const media = MessageMedia.fromFilePath(mp4FilePath);
                await client.sendMessage(msg.from, media);
                console.log(`Sent converted file: ${mp4FilePath}`);

                // Delete both the original .webm and converted .mp4 files after sending
                fs.unlinkSync(webmOutputPath);
                fs.unlinkSync(mp4FilePath);
                console.log(`Deleted files: ${webmOutputPath} and ${mp4FilePath}`);
                resolve();
            } catch (conversionError) {
                console.error('Error converting or sending .webm file:', conversionError);
                reject(new Error('Failed to convert or send .webm file.'));
            }
        });
    });
};

// Function to convert .webm to .mp4
function convertWebmToMp4(webmFilePath) {
    return new Promise((resolve, reject) => {
        const mp4FilePath = webmFilePath.replace('.webm', '.mp4');
        
        ffmpeg(webmFilePath)
            .output(mp4FilePath)
            .on('end', () => {
                console.log(`Converted ${webmFilePath} to ${mp4FilePath}`);
                resolve(mp4FilePath);
            })
            .on('error', (err) => {
                console.error('Error converting .webm to .mp4:', err);
                reject(err);
            })
            .run();
    });
}

// Command handler for YouTube download
client.on('message', async msg => {
    if (msg.body.startsWith("!yt")) {
        const args = msg.body.split(" ");
        
        if (args.length < 2) {
            await client.sendMessage(msg.from, "Please provide a YouTube URL.");
            return;
        }
        
        const url = args[1];
        const format = args[2] === 'video' ? 'mp4' : 'mp3'; 

        // Validate URL format
        const isValidUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/.test(url);
        if (!isValidUrl) {
            await client.sendMessage(msg.from, "Please provide a valid YouTube URL.");
            return;
        }

        await client.sendMessage(msg.from, `Downloading your YouTube ${format}...`);
        try {
            await downloadYouTubeMedia(url, msg, format);
        } catch (error) {
            await client.sendMessage(msg.from, "Failed to download in the requested format. Try !sendwebm");
        }
    }
});

// Function to convert .webm to .mp4
function convertWebmToMp4(webmFilePath) {
    return new Promise((resolve, reject) => {
        const mp4FilePath = webmFilePath.replace('.webm', '.mp4');
        
        ffmpeg(webmFilePath)
            .output(mp4FilePath)
            .on('end', () => {
                console.log(`Converted ${webmFilePath} to ${mp4FilePath}`);
                resolve(mp4FilePath);
            })
            .on('error', (err) => {
                console.error('Error converting .webm to .mp4:', err);
                reject(err);
            })
            .run();
    });
}

// Helper function to send .webm files after conversion and delete them after sending
async function sendAndDeleteWebmFiles(msg) {
    fs.readdir(tempDir, async (err, files) => {
        if (err) {
            console.error('Error reading temp directory:', err);
            return;
        }

        // Find .webm files in the temp directory
        const webmFiles = files.filter(file => file.endsWith('.webm'));

        for (const file of webmFiles) {
            const webmFilePath = path.join(tempDir, file);

            try {
                // Convert the .webm file to .mp4
                const mp4FilePath = await convertWebmToMp4(webmFilePath);
                
                // Send the converted .mp4 file
                const media = MessageMedia.fromFilePath(mp4FilePath);
                await client.sendMessage(msg.from, media);
                console.log(`Sent converted file: ${mp4FilePath}`);

                // Delete both the original .webm and converted .mp4 files after sending
                fs.unlinkSync(webmFilePath);
                fs.unlinkSync(mp4FilePath);
                console.log(`Deleted files: ${webmFilePath} and ${mp4FilePath}`);
            } catch (error) {
                console.error('Error processing and sending .webm file:', error);
            }
        }
    });
}

// Command to trigger .webm file sending
client.on('message', async msg => {
    if (msg.body.startsWith("!sendwebm")) {
        await sendAndDeleteWebmFiles(msg);
    }
});

// Helper function for Instagram and TikTok download
async function downloadSocialMediaVideo(url, msg, platform) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(tempDir, `${platform}_video.mp4`);

        // Define yt-dlp command based on platform
        const ytDlpCommand = `yt-dlp "${url}" --output "${outputPath}" --format mp4 --restrict-filenames`;

        exec(ytDlpCommand, async (error, stdout, stderr) => {
            if (error) {
                console.error(`Error downloading from ${platform}:`, error);
                await client.sendMessage(msg.from, `Failed to download the ${platform} video.`);
                reject(new Error(`Failed to download ${platform} video.`));
                return;
            }

            console.log(`${platform} download stdout:`, stdout);
            console.error(`${platform} download stderr:`, stderr);

            // Send downloaded video
            const media = MessageMedia.fromFilePath(outputPath);
            try {
                await client.sendMessage(msg.from, media);
                console.log(`Sent ${platform} video: ${outputPath}`);
                
                // Clean up the file after sending
                fs.unlinkSync(outputPath);
                console.log(`Deleted file: ${outputPath}`);
                resolve();
            } catch (err) {
                console.error(`Error sending ${platform} video:`, err);
                reject(new Error(`Failed to send ${platform} video.`));
            }
        });
    });
}

// Command handler for Instagram and TikTok download
client.on('message', async msg => {
    const args = msg.body.split(" ");
    const command = args[0].toLowerCase();
    const url = args[1];

    if (command === "!insta" || command === "!tiktok") {
        if (!url) {
            await client.sendMessage(msg.from, "Please provide a valid URL.");
            return;
        }

        // Validate URL format for Instagram and TikTok
        const instaRegex = /^(https?:\/\/)?(www\.)?(instagram\.com)\/.+$/;
        const tiktokRegex = /^(https?:\/\/)?(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\/.+$/;
        const isValidUrl = (command === "!insta" && instaRegex.test(url)) ||
                           (command === "!tiktok" && tiktokRegex.test(url));

        if (!isValidUrl) {
            await client.sendMessage(msg.from, `Please provide a valid ${command === "!insta" ? "Instagram" : "TikTok"} URL.`);
            return;
        }

        await client.sendMessage(msg.from, `Downloading your ${command === "!insta" ? "Instagram" : "TikTok"} video...`);
        try {
            await downloadSocialMediaVideo(url, msg, command === "!insta" ? "Instagram" : "TikTok");
        } catch (error) {
            console.error(`Error downloading ${command === "!insta" ? "Instagram" : "TikTok"} video:`, error);
            await client.sendMessage(msg.from, `Failed to download the ${command === "!insta" ? "Instagram" : "TikTok"} video.`);
        }
    }
});

// Function to fetch upcoming anime
async function getUpcomingAnime() {
    try {
        const response = await axios.get('https://api.jikan.moe/v4/seasons/upcoming');
        return response.data.data; // Return the list of upcoming anime
    } catch (error) {
        console.error('Error fetching upcoming anime:', error);
        return [];
    }
}

// Function to download an image and return its path
async function downloadImage(url, filename) {
    const filePath = path.join(tempDir, filename);
    const response = await axios({
        url,
        responseType: 'stream',
    });

    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);
        response.data.pipe(writeStream);
        writeStream.on('finish', () => {
            resolve(filePath);
        });
        writeStream.on('error', reject);
    });
}

// Function to handle the command for upcoming anime
async function handleUpcomingAnimeCommand(chatId) {
    const animeList = await getUpcomingAnime();
    if (animeList.length === 0) {
        sendMessage(chatId, "No upcoming anime found.");
        return;
    }

    for (const anime of animeList) {
        const imageUrl = anime.images.jpg.large_image_url;
        const filename = `${anime.title.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`; // Sanitize title for filename

        try {
            const imagePath = await downloadImage(imageUrl, filename); // Download image
            await sendMessage(chatId, `*Title:* ${anime.title}\n*Start Date:* ${anime.start_date}`, imagePath); // Send message with image
            fs.unlinkSync(imagePath); // Delete the image after sending
        } catch (error) {
            console.error(`Error downloading or sending image for ${anime.title}:`, error);
            sendMessage(chatId, `Error fetching image for ${anime.title}.`);
        }
    }
}

// Function to send a message using whatsapp-web.js
async function sendMessage(chatId, message, imagePath = null) {
    if (imagePath) {
        const media = new MessageMedia('image/jpeg', fs.readFileSync(imagePath).toString('base64'), path.basename(imagePath));
        await client.sendMessage(chatId, media, { caption: message });
    } else {
        await client.sendMessage(chatId, message);
    }
}

// Function to listen for incoming messages
client.on('message', message => {
    const chatId = message.from; // Get the chat ID from the incoming message
    const text = message.body; // Get the message text

    // Check if the message is the command for upcoming anime
    if (text === '!upcominganime') {
        handleUpcomingAnimeCommand(chatId);
    }
});

// Create temp directory if it doesn't exist
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

const genreMap = {
    'Action': 1,
    'Adventure': 2,
    'Cars': 3,
    'Comedy': 4,
    'Avante Garde': 5,
    'Demons': 6,
    'Mystery': 7,
    'Drama': 8,
    'Ecchi': 9,
    'Fantasy': 10,
    'Game': 11,
    'Hentai': 12,
    'Historical': 13,
    'Horror': 14,
    'Kids': 15,
    'Martial Arts': 17,
    'Mecha': 18,
    'Music': 19,
    'Parody': 20,
    'Samurai': 21,
    'Romance': 22,
    'School': 23,
    'Sci-Fi': 24,
    'Shoujo': 25,
    'Shoujo Ai': 26,
    'Shounen': 27,
    'Shounen Ai': 28,
    'Space': 29,
    'Sports': 30,
    'Super Power': 31,
    'Vampire': 32,
    'Yaoi': 33,
    'Yuri': 34,
    'Harem': 35,
    'Slice of Life': 36,
    'Supernatural': 37,
    'Military': 38,
    'Police': 39,
    'Psychological': 40,
    'Suspense': 41,
    'Seinen': 42,
    'Josei': 43,
};

// Function to fetch anime by genre
async function getAnimeByGenre(genreId) {
    try {
        const response = await axios.get(`https://api.jikan.moe/v4/anime?genres=${genreId}&order_by=score&sort=desc`);
        return response.data.data;
    } catch (error) {
        console.error('Error fetching anime by genre:', error);
        return [];
    }
}

// Function to handle the command for anime by genre
async function handleAnimeGenreCommand(chatId, genre) {
    const genreId = genreMap[genre];
    if (!genreId) {
        sendMessage(chatId, `Genre '${genre}' not found. Please try another genre.`);
        return;
    }

    const animeList = await getAnimeByGenre(genreId);
    if (animeList.length === 0) {
        sendMessage(chatId, `No anime found in the genre '${genre}'.`);
        return;
    }

    for (const anime of animeList.slice(0, 5)) { // Limit to top 5 anime
        const imageUrl = anime.images.jpg.large_image_url;
        const filename = `${anime.title.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`;

        try {
            const imagePath = await downloadImage(imageUrl, filename);
            await sendMessage(
                chatId,
                `*Title:* ${anime.title}\n*Score:* ${anime.score}\n*Synopsis:* ${anime.synopsis}`,
                imagePath
            );
            fs.unlinkSync(imagePath);
        } catch (error) {
            console.error(`Error downloading or sending image for ${anime.title}:`, error);
            sendMessage(chatId, `Error fetching image for ${anime.title}.`);
        }
    }
}

// Function to download an image and return its path
async function downloadImage(url, filename) {
    const filePath = path.join(tempDir, filename);
    const response = await axios({ url, responseType: 'stream' });

    return new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(filePath);
        response.data.pipe(writeStream);
        writeStream.on('finish', () => resolve(filePath));
        writeStream.on('error', reject);
    });
}

// Function to send a message using whatsapp-web.js
async function sendMessage(chatId, message, imagePath = null) {
    if (imagePath) {
        const media = new MessageMedia('image/jpeg', fs.readFileSync(imagePath).toString('base64'), path.basename(imagePath));
        await client.sendMessage(chatId, media, { caption: message });
    } else {
        await client.sendMessage(chatId, message);
    }
}

// Listen for incoming messages
client.on('message', message => {
    const chatId = message.from;
    const text = message.body;

    // Check if the message starts with !anime followed by a genre
    if (text.startsWith('!anime ')) {
        const genre = text.split(' ')[1];
        handleAnimeGenreCommand(chatId, genre.charAt(0).toUpperCase() + genre.slice(1).toLowerCase());
    }
});

// Create temp directory if it doesn't exist
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

//////////
// Handle commands
client.on('message', async msg => {
    if (msg.body.startsWith(prefix)) {
        if (isOnCooldown(msg)) return;

        const args = msg.body.slice(prefix.length).trim().split(/ +/); 
        const cmd = args.shift().toLowerCase();  // Extract command
        const commandArg = args.join(" ");  // Extract the rest as arguments

        switch (cmd) {
            case "s":
                try {
                    const mediaData = await downloadMedia(msg);
                    if (!mediaData) return;

                    if (mediaData.mimetype === 'image/webp') {
                        await client.sendMessage(msg.from, mediaData, { sendMediaAsSticker: true });
                    } else if (mediaData.mimetype === 'video/mp4' || mediaData.mimetype === 'image/gif') {
                        processGifOrVideoSticker(mediaData, msg);
                    } else if (mediaData.mimetype === 'image/jpeg' || mediaData.mimetype === 'image/png') {
                        const textToOverlay = "Sticker";  // Default text to overlay
                        await processImageSticker(mediaData, textToOverlay, msg);
                    } else {
                        await client.sendMessage(msg.from, "Unsupported media format. Please send an image (PNG, JPG) or a video (MP4/GIF).");
                    }
                } catch (error) {
                    console.error('Error processing media:', error);
                    await client.sendMessage(msg.from, "Failed to process media.");
                }
                break;

            case "s2": // Sticker command for GIFs and short videos
                try {
                    const mediaData = await downloadMedia(msg);
                    if (!mediaData) return;

                    if (mediaData.mimetype === 'image/gif' || mediaData.mimetype === 'video/mp4') {
                        // Use the correct function to process GIFs or videos
                        processGifOrVideoSticker(mediaData, msg);
                    } else {
                        await client.sendMessage(msg.from, "Please send a GIF or video to convert into an animated sticker.");
                    }
                } catch (error) {
                    console.error('Error processing media:', error);
                    await client.sendMessage(msg.from, "Failed to process media.");
                }
                break;

            // Command to send music files
            case "spotify":
                if (!commandArg || !commandArg.includes('spotify.com')) {
                    await client.sendMessage(msg.from, "Please provide a valid Spotify URL.");
                    return;
                }
                try {
                    await client.sendMessage(msg.from, "Downloading your Spotify track...");
                    await downloadSpotifySong(commandArg, msg);
                } catch (error) {
                    console.error('Error downloading Spotify song:', error);
                    await client.sendMessage(msg.from, "Failed to download the Spotify track.");
                }
                break;

            // Example: Custom music playback command
            case "music":
                const musicFiles = getMusicFiles();
                if (musicFiles.length === 0) {
                    await client.sendMessage(msg.from, "No music files available in the folder.");
                    return;
                }

                // Optionally, you can allow users to request a specific song by filename
                if (commandArg) {
                    const requestedFile = musicFiles.find(file => file.toLowerCase().includes(commandArg.toLowerCase()));
                    if (requestedFile) {
                        const musicFilePath = path.join(musicFolderPath, requestedFile);
                        const musicMedia = MessageMedia.fromFilePath(musicFilePath);
                        await client.sendMessage(msg.from, musicMedia);
                    } else {
                        await client.sendMessage(msg.from, "Requested song not found.");
                    }
                } else {
                    // Send the list of available music files
                    const fileListMessage = `Available music files:\n${musicFiles.join('\n')}`;
                    await client.sendMessage(msg.from, fileListMessage);
                }
                break;
                
        }
    }
});

// Initialize the WhatsApp client
client.on('ready', () => {
    console.log('Client is ready.');
});

client.initialize();
