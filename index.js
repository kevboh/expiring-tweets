const Twitter = require('twitter');
const fetch = require('isomorphic-fetch'); // or another library of choice.
const Dropbox = require('dropbox').Dropbox;
const ignoredTweets = require('./ignored-tweets.json');

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
    ...(max_id ? { max_id } : {})
  });

  const pageTweets = maxID =>
    client.get('statuses/user_timeline', params(maxID)).then(tweets => {
      console.log(tweets.length);
      var minID = Number.POSITIVE_INFINITY;
      const promises = [];
      tweets.forEach(tweet => {
        promises.push(fx(tweet));
        if (tweet.id < minID) {
          minID = tweet.id;
        }
      });

      if (tweets.length > 1) {
        console.log(minID);
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

  if (ignoredTweets.find(v => v === tweet.id)) {
    console.log('Ignored, in json: ', tweet.full_text);
    return Promise.resolve();
  } else if (now.getTime() - tweetDate.getTime() < threshold) {
    console.log('Ignored, too young: ', tweet.full_text, tweetDate);
    return Promise.resolve();
  } else {
    // Save tweet, then delete it

    const path = `/${tweet.id}.json`;
    console.log(`Saving ${path}...`);

    const contents = JSON.stringify(tweet);

    return dbx
      .filesUploadSessionStart({
        contents,
        close: true
      })
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
