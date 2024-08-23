const axios = require('axios');
require('dotenv').config();

const sleep = time => new Promise(res => setTimeout(res, time * 1000));

const get = async (url) => {
    try {
        const request = await axios.get(`https://${url}`);
        if (request.status !== 200) throw new Error('Request failed');
        return request.data;
    } catch (error) {
        console.error(`[ERROR] Failed to GET from ${url}: ${error.message}`);
        await sleep(1);
        return await get(url);
    }
};

async function fetchOnlineFriends(userId) {
    console.log(`[INFO] Fetching online friends for user ID: ${userId}...`);
    const friendsResponse = await get(`friends.roblox.com/v1/users/${userId}/friends`);
    const onlineFriends = friendsResponse.data.filter(friend => friend.isOnline);
    console.log(`[INFO] Found ${onlineFriends.length} online friends for user ID: ${userId}.`);
    return onlineFriends;
}

async function fetchAndCheckFriendsOfFriends(mainUserId, friend, serverThumbnails, mainUserFriends) {
    const friendsOfFriend = await fetchOnlineFriends(friend.id);
    const subTree = {};

    for (const subFriend of friendsOfFriend) {
        if (subFriend.id === mainUserId || mainUserFriends.some(f => f.id === subFriend.id)) continue;

        try {
            const subFriendThumbResponse = await get(`thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${subFriend.id}&size=150x150&format=Png&isCircular=false`);
            const subFriendThumb = subFriendThumbResponse.data[0].imageUrl;
            console.log(`[DEBUG] Checking friend of friend: ${subFriend.name} (${subFriendThumb})`);

            const isSubFriendInServer = serverThumbnails.includes(subFriendThumb);

            // Füge den subFriend in den subTree ein, aber nur, wenn er im Server ist oder online
            if (isSubFriendInServer) {
                subTree[`${subFriend.name} [IN SERVER]`] = {};  // Leeres Objekt zum Anzeigen weiterer Knoten
            } else {
                subTree[`${subFriend.name} [ONLINE]`] = {};  // Leeres Objekt zum Anzeigen weiterer Knoten
            }
        } catch (error) {
            console.error(`[ERROR] Failed to fetch thumbnail for friend of friend ${subFriend.name}: ${error.message}`);
        }
    }

    return Object.keys(subTree).length > 0 ? subTree : null;  // Gib nur den Baum zurück, wenn es Einträge gibt
}

async function findFriendsInServer(userId, placeId, serverId, allThumbnails) {
    const onlineFriends = await fetchOnlineFriends(userId);
    const tree = {};

    if (onlineFriends.length === 0) {
        console.log('[INFO] No online friends found.');
        return tree;  // Rückgabe eines leeren Baums
    }

    const serverThumbnails = allThumbnails.get(serverId) || [];

    console.log('[INFO] Comparing online friends with players in the server...');
    console.log(`[DEBUG] Server player thumbnails: ${serverThumbnails.join(', ')}`);

    for (const friend of onlineFriends) {
        try {
            const friendThumbResponse = await get(`thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${friend.id}&size=150x150&format=Png&isCircular=false`);
            const friendThumb = friendThumbResponse.data[0].imageUrl;
            console.log(`[DEBUG] Checking friend: ${friend.name} (${friendThumb})`);

            const isFriendInServer = serverThumbnails.includes(friendThumb);

            const friendStatus = isFriendInServer ? "[IN SERVER]" : "[ONLINE]";
            let friendSubTree = await fetchAndCheckFriendsOfFriends(userId, friend, serverThumbnails, onlineFriends);

            // Füge den Freund und seine Freunde nur hinzu, wenn es relevante Einträge gibt
            if (friendSubTree) {
                tree[`${friend.name} ${friendStatus}`] = friendSubTree;
            } else {
                tree[`${friend.name} ${friendStatus}`] = {};  // Keine weiteren Unterknoten
            }
        } catch (error) {
            console.error(`[ERROR] Failed to fetch thumbnail for friend ${friend.name}: ${error.message}`);
        }
    }

    // Überprüfe offline Freunde und füge sie dem Baum hinzu
    const allFriends = await get(`friends.roblox.com/v1/users/${userId}/friends`);
    for (const friend of allFriends.data) {
        if (!onlineFriends.some(f => f.id === friend.id)) {
            tree[`${friend.name} [OFFLINE]`] = {};  // Offline Freund, keine weiteren Unterknoten
        }
    }

    console.log("\nFriendship Tree:");
    printTree(tree);
    console.log("\nFriendship Tree (JSON):", JSON.stringify(tree, null, 2));

    return tree; // Rückgabe des erstellten Baums
}

function printTree(tree, prefix = '') {
    const keys = Object.keys(tree);
    keys.forEach((key, index) => {
        const isLast = index === keys.length - 1;
        const newPrefix = prefix + (isLast ? '└───' : '├───');

        if (tree[key] && Object.keys(tree[key]).length > 0) {
            console.log(newPrefix + key);
            printTree(tree[key], prefix + (isLast ? '    ' : '│   '));
        } else {
            console.log(newPrefix + key);  // Für null-Werte, nur den Schlüssel ausgeben
        }
    });
}

module.exports = { findFriendsInServer };
