/*jslint esversion: 6*/
const schedule = require('node-schedule');
const _ = require('underscore');
const moment = require('moment');
const request = require('request');
const config = require('../../../config');
const bot = require('../../../bots/telegram');
const stats = require('./stats');
const List = require('../../../models/list');
const Joke = require('../../../models/joke');
const TenThings = require('../../../models/games/tenthings');


const getJoke = schedule.scheduleJob('0 0 */3 * * *', () => {

  request({
    method: 'GET',
    url: 'https://webknox-jokes.p.rapidapi.com/jokes/random',
    qs: {minRating: '7'},
    headers: {
      'X-RapidAPI-Host': 'webknox-jokes.p.rapidapi.com' ,
      'X-RapidAPI-Key': config.tokens.rapidapi
    }
  }, (err, response, body) => {
    const joke = JSON.parse(body);
    Joke.findOne({
      joke: joke.joke
    }).exec((err, existingJoke) => {
      bot.notifyAdmin(joke.joke);
      if (!existingJoke) {
        const newJoke = new Joke(joke);
        newJoke.save(err => {
          if (err) return console.error(err);
          console.log('Joke saved!');
        });
      }
    });
  });
});


/*
TenThings.find()
.then(function(games) {
  games.forEach(function(game, index) {
    setTimeout(function() {
      Promise.all(game.players.map(function(player, index) {
        return isPlayerPresent(game.chat_id, player.id, index);
      })).then(function(absentPlayers) {
        for (var i = 0; i < game.players.length; i++) {
          if (absentPlayers.indexOf(game.players[i].id) >= 0) {
            console.log(game.chat_id, game.players[i].first_name);
            game.players[i].present = false;
          }
        }
        //game.save();
      });
    }, index * 10)
  });
});

function isPlayerPresent(channel, player, index) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      bot.getChatMember(channel, player)
      .then(function(chatMember) {
        resolve()
      }, function(err) {
        resolve(player)
      });
    }, index * 10)
  });
}*/


const newLists = schedule.scheduleJob('0 0 12 * * *', () => {
  List.find({
    $or: [
      {
        date: { $gte: moment().subtract(1, 'days') }
      }
    ]
  })
  .then(lists => {
    if (lists.length > 0) {
      let message = '<b>New lists created today</b>';
      lists.forEach(({name}) => {
        message += `\n- ${name}`;
      });
      TenThings.find({}).select('chat_id')
      .then(games => {
        bot.broadcast(games.map(game => game.chat_id), message);
      });
    } else {
      bot.notifyAdmin('No lists created');
    }
  });
});

const modifiedLists = schedule.scheduleJob('0 5 12 * * *', () => {
  List.find({
    $or: [
      {
        modifyDate: { $gte: moment().subtract(1, 'days') },
        date: { $lt: moment().subtract(1, 'days') }
      }
    ]
  })
  .then(lists => {
    if (lists.length > 0) {
      let message = '<b>Lists updated today</b>';
      lists.forEach(({name}) => {
        message += `\n- ${name}`;
      });
      TenThings.find({}).select('chat_id')
      .then(games => {
        bot.broadcast(games.map(game => game.chat_id), message);
        bot.notifyAdmins(message);
      });
    } else {
      bot.notifyAdmin('No lists modified');
    }
  });
});
//bot.sendPhoto(config.masterChat, 'https://m.media-amazon.com/images/M/MV5BNmE1OWI2ZGItMDUyOS00MmU5LWE0MzUtYTQ0YzA1YTE5MGYxXkEyXkFqcGdeQXVyMDM5ODIyNw@@._V1._SX40_CR0,0,40,54_.jpg')

//var dailyScore = schedule.scheduleJob('*/10 * * * * *', function() {
const dailyScore = schedule.scheduleJob('0 0 0 * * *', () => {
  if (new Date().getHours() === 0) {
  //if (true) {
    bot.notifyAdmin(`Score Reset Triggered; ${moment().format('DD-MMM-YYYY')}`);
    TenThings.find({ 'players.scoreDaily': { $gt: 0 }})
    .populate('list.creator')
    .then(games => {
      const uniquePlayers = [];
      const players = games.reduce((players, game) => {
        stats.getDailyScores(game);
        getHighScore(game).then(highScore => {
          let message = '';
          const winners = [];
          game.players
          .filter(player => player.scoreDaily === highScore)
          .forEach(({_id, first_name}, index, {length}) => {
            winners.push(_id);
            if (index < length - 1) {
              message += `${first_name} & `;
            } else {
              message += first_name;
              setTimeout(() => {
                bot.sendMessage(game.chat_id, `<b>${message} won with ${highScore} points!</b>`);
                console.log(message);
                if (game.chat_id != config.groupChat) {
                  bot.sendMessage(game.chat_id, 'Come join us in the <a href="https://t.me/tenthings">Ten Things Supergroup</a>!');
                }
                TenThings.update(
                  {
                    _id: game._id
                  },
                  {
                    $inc: {
                      'players.$[winner].wins': 1,
                      'players.$[player].plays': 1,
                      'players.$[player].playStreak': 1,
                    },
                    $set: {
                      'players.$[player].scoreDaily': 0,
                      'players.$[idler].playStreak': 0
                    }
                  },
                  {
                    multi: true,
                    arrayFilters: [
                      { 'winner._id': { $in: winners } },
                      { 'player.scoreDaily': { $gt: 0 } },
                      { 'idler.scoreDaily': 0 }
                    ]
                  },
                  (err, saved) => {
                    if (err) console.error(err);
                    console.log(`Win recorded for ${winners}`);
                  }
                );
                try {
                  stats.getList(game, list => {
                    let message = `<b>${game.list.name}</b> (${game.list.totalValues}) by ${game.list.creator.username}\n`;
                    message += game.list.category ? `Category: ${game.list.category}\n` : '';
                    message += game.list.description ? (game.list.description.includes('href') ? game.list.description : `<i>${angleBrackets(game.list.description)}</i>\n`) : '';
                    message += list;
                    bot.sendMessage(game.chat_id, message);
                  });
                } catch (e) {
                  console.error(e);
                }
              }, index * 50);
            }
          });
        });
        return players.concat(game.players.filter(({scoreDaily}) => scoreDaily).map(player => player.id));
      }, []);
      bot.notifyAdmins(`${games.length} games played today with ${players.length} players of which ${_.uniq(players, player => player).length} unique`);
    }, err => {
      console.error(err);
      bot.notifyAdmin(`Update daily score error\n${err}`);
    });
  } else {
    bot.notifyAdmin(`Schedule incorrectly triggered: ${moment().format('DD-MMM-YYYY hh:mm')}`);
  }
  //Delete stale games
  TenThings.find({ 'players.highScore': { $gt: 0 } })
  .then(games => {
    const ids = games.map(({_id}) => _id);
    if (ids.length > 0) {
      TenThings.find({ '_id': { $nin: ids }, 'date': { $lt: moment().subtract(30, 'days') } })
      .then(staleGames => {
        staleGames.forEach(game => {
          game.remove();
        });
        if (staleGames.length > 0) bot.notifyAdmin(`${staleGames.length} stale games deleted`);
      });
    }
  });
});

const inactiveChats = schedule.scheduleJob('0 0 2 * * *', () => {
  TenThings.find({ 'lastPlayDate': { $lt: moment().subtract(30, 'days') } })
  .then(games => {
    Promise.all(games.map((game, i) => {
      return getChat(game.chat_id, i * 50)
    }))
    .then(result => {
      TenThings.deleteMany({ chat_id: { $in: result.filter(game => game.code === 404).map(game => game.id)}}, (err, response) => {
        if (err) return console.error(err);
        bot.notifyAdmin(`${result.filter(game => game.code === 404)} inactive chats deleted`);
      });
    }, err => console.error(err))
  });
});
/*
TenThings.find({ 'players.playStreak': { $gt: 0 } })
.then(games => {

  const activePlayers = games.reduce((players, game) => {
    return players.concat(game.players.filter(player => player.playStreak))
  }, []).length;
  if (games.length > 0) console.log(`${activePlayers} game streaks updated in ${games.length} games`);
  games.forEach(game => {
    console.log(game._id, game.players.filter(player => player.playStreak).map(player => player._id + ' ' + player.playStreak + '/' + player.maxPlayStreak + ' ' + player.lastPlayDate));
    for (const player of game.players) {
      if (player.playStreak <= player.maxPlayStreak && player.lastPlayDate <= moment().subtract(1, 'days')) {
        player.playStreak = 0;
      } else if (player.playStreak > player.maxPlayStreak) {
        player.maxPlayStreak = player.playStreak;
      }
    }
    console.log(game._id, game.players.filter(player => player.playStreak).map(player => player._id + ' ' + player.playStreak + '/' + player.maxPlayStreak + ' ' + player.lastPlayDate));
  });
});
*/

const playStreak = schedule.scheduleJob('0 0 1 * * *', () => {
  //Update play streaks
  TenThings.find({ 'players.playStreak': { $gt: 0 } })
  .select('_id players')
  .then(games => {
    const activePlayers = games.reduce((players, game) => {
      return players.concat(game.players.filter(player => player.playStreak));
    }, []).length;
    if (games.length > 0) bot.notifyAdmin(`${activePlayers} game streaks updated in ${games.length} games`);
    games.forEach(game => {
      for (const player of game.players) {
        if (player.playStreak > 0) {
          if (player.playStreak > player.maxPlayStreak) {
            player.maxPlayStreak = player.playStreak;
          }
          if (player.lastPlayDate <= moment().subtract(1, 'days')) {
            player.playStreak = 0;
          }
        }
      }
      game.save((err, saved, rows) => {
        if (err) console.error(err);
        console.log(saved, game._id);
      });
    });
  });
});

const getHighScore = (game) => new Promise((resolve, reject) => {
  try {
    resolve(game.players.reduce((highScore, {id, scoreDaily}) => {
      return (scoreDaily > highScore) ? scoreDaily : highScore;
    }, 0));
  } catch(e) {
    reject();
  }
});

function angleBrackets(str) {
  return str.replace('<','&lt;').replace('>','&gt;');
}

function getChat(chat, delay) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      bot.getChat(chat)
      .then(result => resolve(result), err => resolve(err));
    }, delay);
  });
}