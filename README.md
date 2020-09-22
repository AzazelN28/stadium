# Stadium

## Installation

You need to use [NVM](https://github.com/nvm-sh/nvm) or use Node.js 9.11.2

```sh
nvm use
npm i
```

IMPORTANT! I used an old version of Node because it's the latest one that works with [robot-js](https://getrobot.net).

## Architecture

Right now the application is a huge monolithic codebase based on Koa, socket.io and wrtc. But it could be split in three different services:

1. A web server that serves client resources (html, css, js).
2. A web socket server that allows the user to start and stop games and exchanges WebRTC info.
3. A "virtual player" that receives key presses and mouse position and sends audio and video. This is running alongside the http and ws server but it would be much better if it runs as a separate thread.

## TODO

Currently audio isn't working, I installed naudiodon and started to do some research but I didn't have time to finish it.

Made with :heart: by [AzazelN28](https://github.com/azazeln28/stadium.git)
