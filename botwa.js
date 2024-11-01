const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const sharp = require('sharp'); // For image processing
const ffmpeg = require('fluent-ffmpeg'); // For video/GIF processing
const fs = require('fs'); // For handling file system
const axios = require('axios'); // For IP location fetching
const path = require('path'); // For handling file paths
const ytdl = require('ytdl-core'); // YouTube downloader
const { exec } = require('child_process'); // To run spotdl command
const youtubedl = require('youtube-dl-exec');

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

const musicFolderPath = 'C:\\BOT\\spotify'; // Change to the 'spotify' directory
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
                    <text x="50%" y="50%" font-size="32" fill="white" text-anchor="middle" dominant-baseline="middle">${textToOverlay}</text>
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

        exec(ytDlpCommand, (error, stdout, stderr) => {
            if (error) {
                console.error('Error downloading or sending YouTube', format, ':', error);
                reject(new Error(`Error downloading or sending YouTube ${format}: ${error.message}`));
                return;
            }

            console.log('yt-dlp stdout:', stdout);
            console.error('yt-dlp stderr:', stderr);

            // After download completes, look for any file in the temp directory
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
                    console.log(`Attempting to send file: ${filePathToSend}`); // Log the file being sent
                    
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
            }, 1000); // Increased the timeout to allow for file operations to complete
        });
    });
};

// Function to clean up the temp folder
const cleanUpTempFolder = (folderPath) => {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(folderPath, file);
            // Check if the file is a regular file and not a directory
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error('Error getting file stats:', err);
                    return;
                }
                // Remove files that are not .mp4 or .mp3
                if (stats.isFile() && !filePath.endsWith('.mp4') && !filePath.endsWith('.mp3')) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error('Error deleting file:', err);
                        } else {
                            console.log('Deleted file:', filePath);
                        }
                    });
                }
            });
        });
    });
};


// Command handler for YouTube download
client.on('message', async msg => {
    if (msg.body.startsWith("!yt")) {
        const args = msg.body.split(" ");
        
        // Ensure there's at least one argument (the URL)
        if (args.length < 2) {
            await client.sendMessage(msg.from, "Please provide a YouTube URL.");
            return;
        }
        
        const url = args[1];
        const format = args[2] === 'video' ? 'mp4' : 'mp3'; // Default to 'mp3' if no format is specified

        // Validate URL format
        const isValidUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/.test(url);
        if (!isValidUrl) {
            await client.sendMessage(msg.from, "Please provide a valid YouTube URL.");
            return;
        }

        await client.sendMessage(msg.from, `Downloading your YouTube ${format}...`);
        await downloadYouTubeMedia(url, msg, format);
    }
});


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

                
            case "ytdl":
                    if (!commandArg || !commandArg.includes('youtube.com') && !commandArg.includes('youtu.be')) {
                            await client.sendMessage(msg.from, "Please provide a valid YouTube URL.");
                            return;
                        }
                        await client.sendMessage(msg.from, "Downloading your YouTube audio...");
                        await downloadYouTubeAudio(commandArg, msg);
                        break;
        }
    }
});

// Initialize the WhatsApp client
client.on('ready', () => {
    console.log('Client is ready.');
});

client.initialize();
