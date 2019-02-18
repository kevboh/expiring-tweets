const express = require('express');
const app = express();
const port = process.env.PORT;

app.get('/', (req, res) =>
  res.send(
    'Never forget that the Lethe runs through the very center of the internet.'
  )
);

app.listen(port, () => console.log(`Listening on port ${port}`));
