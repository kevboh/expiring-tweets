const express = require('express');
const app = express();
const port = process.env.PORT;

app.get('/', (req, res) => res.send('What’s up?'));

app.listen(port, () => console.log(`Listening on port ${port}`));
