# expiring-tweets

Simple script (and, optionally, Heroku app) to:

1. delete tweets older than a certain interval, currently hardcoded to be 14 days, and
2. delete likes, saving any links in them to Pinboard.

Deleted tweets and likes are saved as JSON in a Dropbox app's `Apps/app-name` folder for your own personal curiosity. Preconfigured to run in Heroku with Heroku Scheduler.

This was something I threw together to satisfy my own constraints—I wanted a Dropbox archive, specifically—and because I wanted to see how these pieces would fit together. If you don't care about the Dropbox bit, there are [probably better solutions](https://www.google.com/search?q=delete+tweets+older+than).

## How to use it

1. Wherever you want to run this, on your own machine or in Heroku, you need to set some env vars. You'll need to create a [Twitter app](https://developer.twitter.com) and [Dropbox app](https://www.dropbox.com/developers/apps) to get the necessary tokens. When creating the Dropbox app, specify the dedicated folder option—your tweets will appear there.

```sh
export TWITTER_CONSUMER_KEY="your-consumer-key"
export TWITTER_CONSUMER_SECRET="your-consumer-secret"
export TWITTER_ACCESS_TOKEN_KEY="your-twitter-access-token"
export TWITTER_ACCESS_TOKEN_SECRET="your-twitter-access-token-secret"
export TWITTER_USERNAME="your-username-on-twitter"
export DROPBOX_ACCESS_TOKEN="your-dropbox-app-access-token"
export PINBOARD_API_TOKEN="user:1234"
```

2. You can optionally throw some tweet IDs (the long number at the end of a single tweet's url) **as a string** in the `ignored-tweets.json` file. Tweets with IDs in that json array will not be deleted (and thus not saved to Dropbox).

3. With those tokens set and json configured, you can run this locally with `yarn install && node expire-tweets.js`. Please be aware that there's no confirm step here—your tweets will immediately start disappearing. Because Dropbox's API is a little wonky and because I care more about the tweets being deleted than true 1:1 archiving, if a tweet's upload to Dropbox fails it will still be deleted. If there's an actual error, though—like a 503 returned, which I saw once in my many rounds of running this—the entire script will stop.

4. This repo is also preconfigured to be runnable as a Heroku app, with the script triggered via Heroku Scheduler. [Create a Heroku app](https://dashboard.heroku.com/), add the heroku remote to this repo, set your env vars as above, and push. Then add the Heroku Scheduler add-on and configure a `tweets-worker` job and a `likes-worker` job to run as frequently or infrequently as you please. The actual web app does nothing.

## Additional Configuration

If you want to change the number of days to retain tweets, edit the `DAYS_THRESHOLD` constant at the top of `expire-tweets.js`. If you want to mess with the number of tweets downloaded from Twitter and sent to Dropbox per respective API call, edit the `BATCH_SIZE` constant—keeping in mind that Twitter doesn't allow timeline fetches larger than 200 tweets, and that I saw strange Dropbox errors with more than 50ish files in flight simultaneously.
