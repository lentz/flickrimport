const { readFileSync } = require('fs');
const glob = require('glob');
const path = require('path');
const _ = require('lodash');
require('dotenv').config();

const albumItemCache = {};

async function getItemsForAlbum(oAuth2Client, albumId) {
  if (albumItemCache[albumId]) { return albumItemCache[albumId]; }

  let pageToken;
  do {
    const albumContentsRes = await oAuth2Client.request({
      method: 'post',
      data: { pageSize: 100, pageToken },
      url: 'https://photoslibrary.googleapis.com/v1/mediaItems:search',
    });
    pageToken = albumContentsRes.data.nextPageToken;
    albumItemCache[albumId] = (albumItemCache[albumId] || []).concat(albumContentsRes.data.mediaItems);
  } while(pageToken);

  return albumItemCache[albumId];
}

async function uploadPhoto(oAuth2Client, flickrPhotoId, albumId) {
  try {
    const files = glob.sync(path.join(process.env.PHOTOS_DIR, `*${flickrPhotoId}*.jpg`));
    if (!files.length) { 
      console.log(`Photo not found with ID ${flickrPhotoId} for album ${albumId}!`);
      return;
    }
    const photoPath = files[0];

    console.log(`Uploading ${path.basename(photoPath)}`);

    const uploadRes = await oAuth2Client.request({
      url: 'https://photoslibrary.googleapis.com/v1/uploads',
      method: 'post',
      data: readFileSync(photoPath),
      headers: {
        'Content-type': 'application/octet-stream',
        'X-Goog-Upload-File-Name': path.basename(photoPath),
        'X-Goog-Upload-Protocol': 'raw',
      },
    });

    const addToAlbumRes = await oAuth2Client.request({
      data: {
        albumId,
        newMediaItems: [{ simpleMediaItem: { uploadToken: uploadRes.data } }],
      },
      method: 'post',
      url: 'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate',
    });

    const result = addToAlbumRes.data.newMediaItemResults[0].status;
    if (result.message !== 'OK') { throw new Error(`Upload failed for ${flickrPhotoId}: ${result}`); }
  } catch(err) {
    console.error(`Error uploading photo ${flickrPhotoId}: ${err.stack}`);
  }
}

async function getAlbums(oAuth2Client) {
  let albums = [];
  let pageToken;
  do {
    const albumsRes = await oAuth2Client.request({
      params: { pageSize: 50, pageToken },
      url: 'https://photoslibrary.googleapis.com/v1/albums',
    });
    albums = albums.concat(albumsRes.data.albums);
    pageToken = albumsRes.data.nextPageToken;
  } while (pageToken);
  
  console.log(`Found ${albums.length} Google albums`);
  return albums;
}

async function importPhotos(oAuth2Client) {
  try {
    const flickrAlbums = JSON.parse(readFileSync(path.join(process.env.METADATA_DIR, 'albums.json')));
    console.log(`Importing ${flickrAlbums.albums.length} Flickr albums`);
    const googleAlbums = await getAlbums(oAuth2Client);

    for (const flickrAlbum of flickrAlbums.albums) {
      console.log(`Uploading ${flickrAlbum.photos.length} photos to ${flickrAlbum.title}`);
      let googleAlbum = googleAlbums.find(album => flickrAlbum.title === album.title);
      if (!googleAlbum) {
        console.log(`Creating album for ${flickrAlbum.title}`)
        const createAlbumRes = await oAuth2Client.request({
          data: { album: { title: flickrAlbum.title } },
          method: 'post',
          url: 'https://photoslibrary.googleapis.com/v1/albums',
        });
        googleAlbum = createAlbumRes.data;
      }

      if (parseInt(googleAlbum.mediaItemsCount, 10) === flickrAlbum.photos.length) {
        console.log(`All ${googleAlbum.mediaItemsCount} items already imported to ${googleAlbum.title}`)
      } else {
        const photoChunks = _.chunk(flickrAlbum.photos, 5);
        for (const photoChunk of photoChunks) {
          await Promise.all(photoChunk.map(photoId => uploadPhoto(oAuth2Client, photoId, googleAlbum.id)));
        }
        console.log(`Completed import for ${flickrAlbum.title}`);
      }
    }
  } catch (err) {
    console.log(err.stack);
  }
}

module.exports = {
  importPhotos,
};
