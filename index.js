const Twitter = require('twitter');
const fetch = require('isomorphic-fetch'); // or another library of choice.
const Dropbox = require('dropbox').Dropbox;
const ignoredTweets = require('./ignored-tweets.json');
const bigInt = require('big-integer');

const DAYS_THRESHOLD = 14;
const BATCH_SIZE = 50;

const dbx = new Dropbox({
  accessToken: process.env.DROPBOX_ACCESS_TOKEN,
  fetch: fetch
});

const client = new Twitter({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token_key: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

function forAllTweets(fx, commit) {
  const params = max_id => ({
    screen_name: process.env.TWITTER_USERNAME,
    trim_user: true,
    count: BATCH_SIZE,
    exclude_replies: false,
    include_rts: true,
    tweet_mode: 'extended',
    ...(max_id ? { max_id: max_id.toString() } : {})
  });

  const pageTweets = maxID =>
    client.get('statuses/user_timeline', params(maxID)).then(tweets => {
      console.log(tweets.length);
      var minID = undefined;
      const promises = [];
      tweets.forEach(tweet => {
        promises.push(fx(tweet));
        const bigTweetID = bigInt(tweet.id_str);
        if (minID === undefined || bigTweetID.compare(minID) === -1) {
          minID = bigTweetID;
        }
      });

      if (tweets.length > 1) {
        console.log('Min ID for page: ', minID.toString());
        return Promise.all(promises)
          .then(commit)
          .then(() => pageTweets(minID));
      } else {
        return Promise.all(promises).then(commit);
      }
    });

  return pageTweets();
}

const processTweet = tweet => {
  const tweetDate = new Date(tweet.created_at);
  const now = new Date();
  const threshold = DAYS_THRESHOLD * 24 * 60 * 60 * 1000;

  if (ignoredTweets.find(v => v === tweet.id_str)) {
    console.log('Ignored, in json: ', tweet.full_text);
    return Promise.resolve();
  } else if (now.getTime() - tweetDate.getTime() < threshold) {
    console.log('Ignored, too young: ', tweet.full_text, tweetDate);
    return Promise.resolve();
  } else {
    // Delete and save tweet

    const path = `/${tweet.id_str}.json`;
    console.log(`Saving ${path}...`);

    const contents = JSON.stringify(tweet);

    return client
      .post(`statuses/destroy/${tweet.id_str}.json`, { trim_user: true })
      .catch(err => {
        console.log(err);
        console.log(tweet);
        fatalError('error');
      })
      .then(() =>
        dbx.filesUploadSessionStart({
          contents,
          close: true
        })
      )
      .then(response => {
        const entry = {
          cursor: {
            session_id: response.session_id,
            offset: Buffer.from(contents).length
          },
          commit: {
            path
          }
        };
        return entry;
      });
  }
};

const waitForPoll = fx => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  return fx().then(result => {
    if (result['.tag'] === 'in_progress') {
      console.log('In progress, waiting 1s...');
      return wait(1000).then(() => waitForPoll(fx));
    } else {
      console.log('Batch committed!');
      if (result['entries']) {
        result['entries'].forEach(entry => {
          if (entry.failure) {
            console.log(entry.failure);
          }
        });
      }
      return result;
    }
  });
};

const commitTweets = results => {
  const entries = results.filter(result => result !== undefined);
  console.log(`Committing batch of ${entries.length} files.`);
  return dbx.filesUploadSessionFinishBatch({ entries }).then(response => {
    const { async_job_id } = response;

    console.log('Now polling commit job ID: ', async_job_id);

    const pollJob = () =>
      dbx.filesUploadSessionFinishBatchCheck({ async_job_id });

    return waitForPoll(pollJob);
  });
};

forAllTweets(processTweet, commitTweets)
  .then(() => process.exit(0))
  .catch(err => console.log('error', err));
