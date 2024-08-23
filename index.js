const express = require('express');
const app = express();
require('dotenv').config();
const axios = require('axios');
const { findFriendsInServer } = require('./friends');

app.get('/', async (req, res) => {
    res.send("Server is up and running! 🚀");
});

app.listen(3000, () => {
    console.log('🚀 Server started on port 3000');
});

let searching = false;
let canceled = false;
let foundAllServers = false;
let searchingTarget = true;
let allPlayers = [];
let playersCount = 0;
let targetsChecked = 0;
let maxPlayers = 0;

let targetServersId = [];
const allThumbnails = new Map();

const sleep = time => new Promise(res => setTimeout(res, time * 1000));

const get = async (url) => {
    try {
        const request = await axios.get(`https://${url}`);
        if (!request.status === 200) throw new Error('Request failed');

        return request.data;
    } catch (error) {
        await sleep(0);
        return await get(url);
    }
};

const post = async (url, body) => {
    try {
        const request = await axios.post(`https://${url}`, body, {
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!request.status === 200) throw new Error('Request failed');

        return request.data;
    } catch (error) {
        await sleep(0.000000000001);
        return await post(url, body);
    }
};

async function fetchServers(place = '', cursor = '', attempts = 0) {
    const { nextPageCursor, data } = await get(`games.roblox.com/v1/games/${place}/servers/Public?limit=100&cursor=${cursor}`);

    if (attempts >= 999) {
        foundAllServers = true;
        return;
    }

    if (!data || data.length === 0) {
        await sleep(0);
        return fetchServers(place, cursor, attempts + 1);
    }

    data.forEach((server) => {
        server.playerTokens.forEach((playerToken) => {
            playersCount += 1;
            allPlayers.push({
                token: playerToken,
                type: 'AvatarHeadshot',
                size: '150x150',
                requestId: server.id,
            });
        });

        maxPlayers = server.maxPlayers;
    });

    if (!nextPageCursor || canceled || !searchingTarget) {
        foundAllServers = true;
        return;
    }

    return fetchServers(place, nextPageCursor);
}

async function findTarget(imageUrl, place, userId) {
    let tree = {};  // Initialize tree
    let serverId = null; // Initialize serverId to store the server ID

    while (searchingTarget) {
        if (canceled) {
            searchingTarget = false;
        }

        const chosenPlayers = [];

        for (let i = 0; i < 100; i++) {
            const playerToken = allPlayers.shift();
            if (!playerToken) break;
            chosenPlayers.push(playerToken);
        }

        if (!chosenPlayers.length) {
            await sleep(0);
            if (targetsChecked === playersCount && foundAllServers) {
                break;
            }
            continue;
        }

        await post('thumbnails.roblox.com/v1/batch', JSON.stringify(chosenPlayers)).then(async ({ data: thumbnailsData }) => {
            if (canceled || !searchingTarget) return;

            for (const thumbnailData of thumbnailsData) {
                const thumbnails = allThumbnails.get(thumbnailData.requestId) || [];

                if (thumbnails.length == 0) {
                    allThumbnails.set(thumbnailData.requestId, thumbnails);
                }

                targetsChecked += 1;

                if (!thumbnails.includes(thumbnailData.imageUrl)) {
                    thumbnails.push(thumbnailData.imageUrl);
                }

                console.log(`[INFO] Checked ${targetsChecked} player tokens so far...`);

                const foundTarget = thumbnailData.imageUrl === imageUrl ? thumbnailData.requestId : null;

                if (foundTarget) {
                    console.log(`[SUCCESS] Player found in server ${thumbnailData.requestId}`);
                    serverId = foundTarget; // Store the server ID
                    const joinLink = `https://www.roblox.com/games/start?launchData=${serverId}&placeId=${place}`;
                    console.log(`[INFO] Join the server directly using this link: ${joinLink}`);
                    console.log(`[INFO] Search completed successfully.`);
                    targetServersId.push(foundTarget);
                    searchingTarget = false; // Stop searching once the target is found

                    // Get the processed tree from friends.js
                    tree = await findFriendsInServer(userId, place, foundTarget, allThumbnails);

                    // Log the tree here
                    console.log(`[INFO] Friendship Tree after findFriendsInServer call:`, JSON.stringify(tree, null, 2));
                }
            }
        });
    }

    searching = false;
    canceled = false;

    console.log(`[INFO] Final Friendship Tree before returning: ${JSON.stringify(tree, null, 2)}`);
    return { found: targetServersId.length > 0, tree: tree, serverId: serverId };
}

async function find(imageUrl, place, userId) {
    allPlayers = [];
    targetServersId = [];

    allThumbnails.clear();
    foundAllServers = false;
    searchingTarget = true;
    allPlayers = [];
    playersCount = 0;
    targetsChecked = 0;
    maxPlayers = 0;

    console.log('[INFO] Searching for player...');

    fetchServers(place);
    const result = await findTarget(imageUrl, place, userId);  // Wait for the target search to complete

    // Log the result of find to see the tree in the final result
    console.log(`[INFO] Result from findTarget including the tree:`, JSON.stringify(result, null, 2));

    return result;
}

app.get('/scrape', async (req, res) => {
    const placeId = req.query.placeid;
    const username = req.query.username;

    if (!placeId || !username) {
        console.error('[ERROR] Missing placeid or username');
        return res.status(400).send('Missing placeid or username');
    }

    try {
        console.log(`[INFO] Starting search for player "${username}" in place "${placeId}"...`);

        // Fetch user data to get avatar image URL
        console.log('[INFO] Fetching user ID...');
        const userResponse = await post('users.roblox.com/v1/usernames/users', JSON.stringify({ usernames: [username] }));

        if (userResponse.errors || userResponse.errorMessage) {
            console.error('[ERROR] User not found!');
            return res.json({ found: false });
        }

        const userId = userResponse.data[0].id;
        console.log(`[INFO] Retrieved user ID: ${userId}`);

        console.log('[INFO] Fetching avatar image URL...');
        const avatarResponse = await get(`thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
        const imageUrl = avatarResponse.data[0].imageUrl;

        console.log(`[INFO] Avatar image URL retrieved: ${imageUrl}`);

        const result = await find(imageUrl, placeId, userId);  // Wait for the search to complete

        // Construct the join link
        const joinLink = result.serverId ? `https://www.roblox.com/games/start?launchData=${result.serverId}&placeId=${placeId}` : null;

        // Log the final result including the tree before sending it to the bot
        console.log(`[INFO] Final JSON response sent to the bot:`, JSON.stringify({
            message: 'Search started',
            found: result.found,
            userId: userId,
            imageUrl: imageUrl,
            friendTree: result.tree,
            joinLink: joinLink // Include the join link in the response
        }, null, 2));

        res.json({ 
            message: 'Search started',
            found: result.found,
            userId: userId,
            imageUrl: imageUrl,
            friendTree: result.tree,
            joinLink: joinLink // Include the join link in the response
        });
    } catch (error) {
        console.error("[ERROR] Error during scraping process:", error.message);
        res.status(500).send('Internal Server Error');
    }
});
