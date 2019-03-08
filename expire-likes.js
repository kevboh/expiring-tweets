const Twitter = require("twitter");
const fetch = require("isomorphic-fetch");
const Dropbox = require("dropbox").Dropbox;
const bigInt = require("big-integer");
const Pinboard = require("node-pinboard").default;

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

const pinboard = new Pinboard(process.env.PINBOARD_API_TOKEN);

function forAllTweets(fx, commit) {
  const params = max_id => ({
    screen_name: process.env.TWITTER_USERNAME,
    count: BATCH_SIZE,
    include_entities: true,
    tweet_mode: "extended",
    ...(max_id ? { max_id: max_id.toString() } : {})
  });

  const pageTweets = maxID =>
    client.get("favorites/list.json", params(maxID)).then(tweets => {
      console.log(tweets.length);
      // console.log(tweets);
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
        console.log("Min ID for page: ", minID.toString());
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
  // Unlike and save tweet
  const path = `/likes/${tweet.id_str}.json`;
  console.log(`Saving ${path}...`);

  const contents = JSON.stringify(tweet);

  return client
    .post(`favorites/destroy.json`, { id: tweet.id_str })
    .catch(err => {
      console.log(err);
      console.log(tweet);
      fatalError("error");
    })
    .then(() => {
      if (
        !tweet.entities ||
        !tweet.entities.urls ||
        tweet.entities.urls.length === 0
      ) {
        return Promise.resolve();
      }

      const urlsCount = tweet.entities.urls.length;

      console.log(
        `Saving ${urlsCount} link${urlsCount > 1 ? "s" : ""} to Pinboard...`
      );
      return Promise.all(
        tweet.entities.urls.map(urlEntity =>
          pinboard.add({
            url: urlEntity.expanded_url || urlEntity.url,
            description: tweet.full_text,
            tags: ["liked-tweet"]
          })
        )
      );
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
};

const waitForPoll = fx => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  return fx().then(result => {
    if (result[".tag"] === "in_progress") {
      console.log("In progress, waiting 1s...");
      return wait(1000).then(() => waitForPoll(fx));
    } else {
      console.log("Batch committed!");
      if (result["entries"]) {
        result["entries"].forEach(entry => {
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

    console.log("Now polling commit job ID: ", async_job_id);

    const pollJob = () =>
      dbx.filesUploadSessionFinishBatchCheck({ async_job_id });

    return waitForPoll(pollJob);
  });
};

forAllTweets(processTweet, commitTweets)
  .then(() => process.exit(0))
  .catch(err => console.log("error", err));
