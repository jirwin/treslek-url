var util = require('util');
var urlLib = require('url');

var async = require('async');
var request = require('request');
var cheerio = require('cheerio');
var Bitly = require('bitly');

var log = require('logmagic').local('treslek.plugins.url');
var config = require('./config.json');


request = request.defaults({
  sendImmediately: true,
  timeout: 10000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.111 Safari/537.36"
  }
});


/*
 * URL plugin
 *   - creates a hook that checks for urls. It then grabs the title
 *     and outputs that to the channel.
 *   Thanks to https://github.com/Floobits/floobot for scraping logic
 */
var Url = function() {
  this.hooks = ['url'];
};


/*
 * Helper function for shortening a url with bitly.
 */
var shortenUrl = function(bitly, url, callback) {
  if (!bitly) {
    callback(null, url);
    return;
  }

  bitly.shorten(url, function(err, resp) {
    if (err) {
      log.error('Error shortening url', {err: err, url: url});
      callback(err);
      return;
    }

    callback(null, resp.data.url || url);
  });
};


function parseYoutube(path, parsed) {
  var title, views, likes, dislikes, rating;

  if (path.match(/^\/watch/) === null) {
    return;
  }

  title = parsed('#eow-title').text().replace(/\n/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
  views = parsed('#watch7-views-info > div.watch-view-count').text().replace(/[\s]/g, '') || 0;
  likes = parsed('#watch-like > span.yt-uix-button-content').text().replace(/[\s,]/g, '') || 0;
  dislikes = parsed('#watch-dislike > span.yt-uix-button-content').text().replace(/[\s,]/g, '') || 0;
  likes = parseInt(likes, 10);
  dislikes = parseInt(dislikes, 10);
  console.log(likes, dislikes);
  rating = Math.round(100 * likes / (likes + dislikes));

  return util.format("%s | %s views %s%% like", title, views, rating);
}


function parseTwitter(path, parsed) {
  var user, title, retweets, favorites;

  if (path.match("^\\/\\w+\\/status\\/\\d+") === null) {
    return;
  }

  user = parsed("div.permalink-tweet-container div.permalink-header a > span.username.js-action-profile-name > b").text();
  title = parsed("div.permalink-tweet-container p.tweet-text").text().replace(/\n/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
  retweets = parsed("div.tweet-stats-container > ul.stats > li.js-stat-count.js-stat-retweets.stat-count > a > strong").text().replace(/\s/g, "") || 0;
  favorites = parsed("div.tweet-stats-container > ul.stats > li.js-stat-count.js-stat-favorites.stat-count > a > strong").text().replace(/\s/g, "") || 0;

  return util.format("<@%s> %s (%s retweets, %s favorites)", user, title, retweets, favorites);
}


function parseReddit(path, parsed) {
  var rating, title, score, comments;

  if (path.match('^\\/r\\/\\w+\\/comments') === null) {
    return;
  }

  title = parsed('p.title > a.title').text().replace(/\n/g, ' ').replace(/^\s+/, '').replace(/\s+$/, '');
  score = parsed('div.score > span.number').text();
  comments = parsed('div.entry > ul.flat-list > li.first > a.comments').text();

  return util.format('%s (%s upvotes, %s)', title, score, comments);
}


/*
 * URL hook.
 *   Searchs a message for any urls, and then request each url.
 *   If the url returns a content-type of 'text/html', attempt
 *   to get the page title. If not, return the content type. If
 *   bitly is configured, shorten urls as well.
 */
Url.prototype.url = function(bot, to, from, msg, callback) {
  var urlReg = /(http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/gi,
      matches = msg.match(urlReg),
      bitly;

  if (!matches) {
    callback();
    return;
  }

  if (config.bitlyUser !== '' && config.bitlyApiKey !== '') {
    bitly = new Bitly(config.bitlyUser, config.bitlyApiKey);
  }

  async.forEach(matches, function(url, callback) {
    request(url, function(err, res, body) {
      var response,
          parsed,
          parsedUrl,
          title,
          contentType;

      if (err || res.statusCode === 404) {
        if (err) {
          log.error('Error retrieving url', {url: url, err: err});
          callback();
          return;
        } else {
          log.error('Error retrieving url. Got response.', {url: url, err: err});
          callback();
          return;
        }
      }

      if (res.statusCode === 200) {
        contentType = res.headers['content-type'].split(';')[0];
        if (contentType !== 'text/html') {
          title = contentType;
        } else {
          parsed = cheerio.load(body);
          title = parsed('title').text().replace(/\n/g, ' ').replace(/^\s+/, '');
        }
      }

      title = title || contentType;

      shortenUrl(bitly, url, function(err, shortUrl) {
        parsedUrl = urlLib.parse(url);
        domain = parsedUrl.hostname.split('.').slice(-2).join('.');
        if (domain === 'youtube.com') {
          response = parseYoutube(parsedUrl.path, parsed) + ' | ' + shortUrl;
        } else if (domain === 'twitter.com') {
          response = parseTwitter(parsedUrl.path, parsed) + ' | ' + shortUrl;
        } else if (domain === 'reddit.com') {
          response = parseReddit(parsedUrl.path, parsed) + ' | ' + shortUrl;
        }

        if (!response) {
          response = title + ' | ' + shortUrl;
        }
        bot.say(to, response);
        callback();
      });

    });
  }, callback);
};


exports.Plugin = Url;
