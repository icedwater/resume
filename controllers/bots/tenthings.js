var router = require('express').Router();
var schedule = require('node-schedule');
var _ = require('underscore');
var FuzzyMatching = require('fuzzy-matching');

var config = require('../../config');
var TelegramBot = require('../../bots/telegram');

var List = require('../../models/list');
var TenThings = require('../../models/games/tenthings');

var cooldowns = {};

var prompts = {
  en: {
    guessed: function(user, text) {
      return user + ' got ' + text;
    }
  },
  fr: {
    guessed: function(user, text) {
      return user + ' a trouve ' + text;
    }
  },
  nl: {
    guessed: function(user, text) {
      return user + ' heeft ' + text + ' gevonden';
    }
  }
};

function getLanguage(language) {
  if (language) {
    if (prompts[language.substring(0, 1)]) {
      return language.substring(0, 1);
    } else {
      return 'en';
    }
  } else {
    return 'en';
  }
}

/*

var lists = [
  {
    name: '',
    values: [
      { value: '' },
      { value: '' },
      { value: '' },
      { value: '' },
      { value: '' },
      { value: '' },
      { value: '' },
      { value: '' },
      { value: '' },
      { value: '' },
    ]
  }
]
List.collection.insert(lists, function (err, insertedLists) {
  console.log(insertedLists);
});
*/

var TOKEN = config.tokens.telegram.tenthings;
var b = new TelegramBot();
b.init(TOKEN).then(function() {
  b.introduceYourself();
  b.setWebhook('tenthings');
});

function selectList(game, callback) {
  List.find({ _id: { $nin: game.playedLists } }).populate('creator').exec(function (err, lists) {
    if (lists.length === 0) {
      game.playedLists = [];
      List.find({}).populate('creator').exec(function (err, lists) {
        return callback(lists[Math.floor(Math.random() * lists.length)]);
      });
    } else {
      return callback(lists[Math.floor(Math.random() * lists.length)]);
    }
  });
}

function skipList(list) {
  List.findOne({ _id: list._id }).exec(function (err, foundList) {
    if (err) return console.error(err);
    if (!foundList.skips) {
      foundList.skips = 1;
    } else {
      foundList.skips++;
    }
    foundList.save(function(err) {
      if (err) return console.error(err);
      console.log('"' + list.name + '" skipped!');
    });
  });
}

function createGame(id, creator) {
  var game = new TenThings({
    chat_id: id,
    players: [creator]
  });
  game.save(function (err) {
  if (err) return console.error(err);
    console.log('Game Saved!');
    return game;
  });
}

function notifyAdmin(msg) {
  b.sendMessage('592503547', JSON.stringify(msg));
}

/*
b.sendMessage('592503547', 'Please rate the list', {
  reply_to_message_id: '592503547',
  reply_markup: JSON.stringify({
    inline_keyboard: [[
      { text: '*', callback_data: '1' },
      { text: '**', callback_data: '2' },
      { text: '***', callback_data: '3' },
      { text: '****', callback_data: '4' },
      { text: '*****', callback_data: '5' }
    ]]
  })
});
*/
/*
getList(function(list) {
  console.log(list);
  list.values = getRandom(list.values, 10);
  console.log(list.values);
});
*/

function guess(game, msg) {
  if (!_.find(game.players, function(existingPlayer) {
    return existingPlayer.id == msg.from.id;
  })) {
    game.players.push(msg.from);
  }
  if (!_.find(game.guessers, function(guesser) {
    return guesser == msg.from.id;
  })) {
    game.guessers.push(msg.from.id);
  }
  var fuzzyMatch = new FuzzyMatching(game.list.values.map(function(item) { return item.value; }));
  var matcher = fuzzyMatch.get(msg.text);
  if (matcher.distance >= 0.9) {
    var match = _.find(game.list.values, function(item) {
      return item.value === matcher.value;
    });
    if (!match.guesser.first_name) {
      match.guesser = msg.from;
      game.list.values.forEach(function(item) {
        if (item.value === match.value) {
          item.guesser = match.guesser;
        }
      });
      var player = _.find(game.players, function(existingPlayer) {
        return existingPlayer.id == msg.from.id;
      });
      player.score += game.guessers.length;
      game.save();
      b.sendMessage(msg.chat.id, prompts[getLanguage(msg.from.language_code)].guessed(msg.from.first_name, match.value + (match.blurb ? '\n<i>' + match.blurb + '</i>' : '') + '\n' + game.list.values.filter(function(item) { return !item.guesser.first_name; }).length + ' answers left.'));
      setTimeout(function() {
        return checkRound(game);
      }, 500);
    } else {
      return b.sendMessage(msg.chat.id, match.guesser.first_name + ' already guessed ' + match.value + '\nToo bad, ' + msg.from.first_name);
    }
  } else if (matcher.distance >= 0.75) {
    setTimeout(function() {
      var match = _.find(game.list.values, function(item) {
        return item.value === matcher.value;
      });
      if (!match.guesser.first_name) {
        match.guesser = msg.from;
        game.list.values.forEach(function(item) {
          if (item.value === match.value) {
            item.guesser = match.guesser;
          }
        });
        var player = _.find(game.players, function(existingPlayer) {
          return existingPlayer.id == msg.from.id;
        });
        player.score += game.guessers.length;
        game.save();
        b.sendMessage(msg.chat.id, prompts[getLanguage(msg.from.language_code)].guessed(msg.from.first_name, match.value + (match.blurb ? '\n<i>' + match.blurb + '</i>' : '') + '\n' + game.list.values.filter(function(item) { return !item.guesser.first_name; }).length + ' answers left.'));
        setTimeout(function() {
          return checkRound(game);
        }, 500);
      }
    }, 2000);
  }
}

function checkRound(game) {
  if (game.list.values.filter(function(item) {
    return !item.guesser.first_name;
  }).length === 0) {
    b.sendMessage(game.id, 'Round over.');
    getScores(game);
    setTimeout(function() {
      newRound(game);
    }, 2000);
  }
}

function newRound(game) {
  selectList(game, function(list) {
    list.plays++;
    list.save();
    game.list = JSON.parse(JSON.stringify(list));
    game.list.values = getRandom(game.list.values, 10);
    game.hints = 0;
    game.hintCooldown = 0;
    game.guessers = [];
    b.sendMessage(game.chat_id, 'A new round will start in 5 seconds');
    setTimeout(function() {
      b.sendMessage(game.chat_id, '<b>' + game.list.name + '</b> by ' + game.list.creator.username);
    }, 5000);
    game.playedLists.push(game.list._id);
    game.save();
  });
}

function getHint(hints, value) {
  var str = '';
  console.log(hints);
  for (var i in value) {
    if (/[ !@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value.charAt(i))) {
      str += value.charAt(i);
    } else {
      console.log(i + ': ' + value.charAt(i));
      switch (hints) {
        case 0:
          str += '*';
          break;
        case 1:
          if (i === 0) {
            str += value.charAt(i);
          } else {
            str += '*';
          }
          break;
        case 2:
          if (i === 0 || value.charAt(i - 1) === ' ') {
            str += value.charAt(i);
          } else {
            str += '*';
          }
          break;
        case 3:
          if (i === 0 || value.charAt(i - 1) === ' ' || value.charAt(i + 1) === ' ' || i === value.length - 1) {
            str += value.charAt(i);
          } else {
            str += '*';
          }
          break;
        case 4:
          if (i === 0 || value.charAt(i - 1) === ' ' || /[aeiuo]/.test(value.charAt(i)) || value.charAt(i + 1) === ' ' || i === value.length - 1) {
            str += value.charAt(i);
          } else {
            str += '*';
          }
          break;
        case 5:
          if (i === 0 || value.charAt(i - 1) === ' ' || /[aeiuojxqzkhfwyv]/.test(value.charAt(i)) || value.charAt(i + 1) === ' ' || i === value.length - 1) {
            str += value.charAt(i);
          } else {
            str += '*';
          }
          break;
        case 6:
          if (i === 0 || value.charAt(i - 1) === ' ' || /[aeiuojxqzkhfwyvcmpb]/.test(value.charAt(i)) || value.charAt(i + 1) === ' ' || i === value.length - 1) {
            str += value.charAt(i);
          } else {
            str += '*';
          }
          break;
        case 7:
          if (i === 0 || value.charAt(i - 1) === ' ' || /[aeiuojxqzkhfwyvcmpbdg]/.test(value.charAt(i)) || value.charAt(i + 1) === ' ' || i === value.length - 1) {
            str += value.charAt(i);
          } else {
            str += '*';
          }
          break;
        default:
          str += value.charAt(i);
      }
    }
  }
  return str;
}

function hint(game, callback) {
  if (game.hints >= 9) {
    b.sendMessage(game.chat_id, 'What? Another hint? I\'m just gonna ignore that request');
  } else if (cooldowns[game.id] && cooldowns[game.id] > 0) {
    b.sendMessage(game.chat_id, 'Calm down with the hints, wait ' + cooldowns[game.id] + ' more seconds');
  } else {
    var str = '';
    game.hints++;
    game.list.values.filter(function(item) {
      return !item.guesser.first_name;
    }).map(function(item) {
      str += getHint(game.hints, item.value);
      /*
      if (game.hints * 2 > item.value.length) {
        str += item.value;
      } else {
        str += item.value.substring(0, game.hints);
        for (var i = game.hints; i < item.value.length - game.hints; i++) {
          if (/[ !@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(item.value.charAt(i))) {
            str += item.value.charAt(i);
          } else {
            str += '*';
          }
        }
        if (item.value.length - game.hints > 0) {
          str += item.value.substring(item.value.length - game.hints);
        }
      }
      */
      str += '\n';
      return str;
    });
    callback(str);
    cooldowns[game.id] = 10;
    cooldownHint(game.id);
    game.save();
  }
}

function cooldownHint(gameId) {
  if (cooldowns[gameId] > 0) {
    cooldowns[gameId]--;
    setTimeout(function() {
      cooldownHint(gameId);
    }, 1000);
  } else {
    delete cooldowns[gameId];
  }
}

function getScores(game) {
  var str = '<b>Scores</b>\n';
  game.players.sort(function(a, b) {
    return b.score - a.score;
  }).slice(0, 10).forEach(function(player, index) {
    str += (index + 1) + ': ' + player.first_name + ' - ' + player.score + '\n';
  });
  b.sendMessage(game.chat_id, str);
}

function getList(game, callback) {
  var str = '';
  game.list.values.map(function(item, index) {
    str += (index + 1) + ': ';
    if (!item.guesser.first_name) {
      str += getHint(game.hints, item.value);
      str += '\n';
    } else {
      str += item.value + ' - <i>' + item.guesser.first_name + '</i>';
      str += '\n';
    }
  });
  callback(str);
}

function getRandom(arr, n) {
  var result = new Array(n),
    len = arr.length,
    taken = new Array(len);
  if (n > len)
    throw new RangeError("getRandom: more elements taken than available");
  while (n--) {
    var x = Math.floor(Math.random() * len);
    result[n] = arr[x in taken ? taken[x] : x];
    taken[x] = --len in taken ? taken[len] : len;
  }
  return result;
}

router.post('/', function (req, res, next) {
  var msg, i, item;
  if (!req.body.message || !req.body.message.text) {
    if (req.body.new_chat_participant) {
      msg = {
        id: req.body.message.chat.id,
        from: req.body.new_chat_participant,
        command: '/info',
        chat: req.body.message.chat
      };
    } else if (req.body.group_chat_created) {
      msg = {
        id: req.body.message.chat.id,
        from: req.body.from,
        command: '/info',
        chat: req.body.message.chat
      };
    } else if (req.body.photo || req.body.emoji || req.body.voice || req.body.animation || req.body.reply_to_message) {
      //Ignore these messages as they're just chat interactions
    } else {
      msg = {
        id: '592503547',
        from: {
          first_name: 'Bot Error'
        },
        command: '/error',
        text: JSON.stringify(req.body),
        chat: {
          id: '592503547'
        }
      };
    }
  } else {
    msg = {
      id: req.body.message.message_id,
      from: req.body.message.from,
      command: req.body.message.text.substring(0, req.body.message.text.indexOf(' ') < 0 ? req.body.message.text.length : req.body.message.text.indexOf(' ')),
      text: req.body.message.text,
      chat: req.body.message.chat
    };
  }
  if (msg.command.indexOf('@') >= 0) {
    msg.command = msg.command.substring(0, msg.command.indexOf('@'));
  }
  //notifyAdmin(msg.from);
  TenThings.findOne({
    chat_id: msg.chat.id
  }).populate('list.creator').exec(function(err, existingGame) {
    if (!existingGame) {
      var newGame = new TenThings({
        chat_id: msg.chat.id
      });
      newGame.save(function (err) {
      if (err) return console.error(err);
        console.log('Game Saved!');
        return evaluateCommand(res, msg, newGame, true);
      });
    } else {
      return evaluateCommand(res, msg, existingGame, false);
    }
  });
  //b.sendMessage(msg.chat.id, 'Received Post');
});

router.get('/', function (req, res, next) {
  //b.sendMessage(msg.chat.id, 'Received Get');
  res.json({ message: 'get ok'});
});

function evaluateCommand(res, msg, game, isNew) {
  //notifyAdmin(tenthings);
  //notifyAdmin(games[msg.chat.id].list);
  console.log(msg.id + ' - ' + msg.from.first_name + ': ' + msg.command + ' -> ' + msg.text);
  if (game.list.values.length === 0) {
    newRound(game);
  }
  switch (msg.command) {
    case '/error':
      b.sendMessage(msg.chat.id, msg.text);
      break;
    case '/info':
    b.sendMessage(msg.chat.id, 'Hi ' + (msg.from.username ? msg.from.username : msg.from.first_name) + ',\nMy name is 10 Things and I am a game bot.\nThe game will give you a category and then you answer anything that comes to mind in that category.\nI have a few things you can ask of me, just type a slash (/) to see the commands.\nIf you want to add your own lists, please go to https://belgocanadian.com/bots\nAnd last but not least if you want to suggest anything (new lists or features) type "/suggest" followed by your suggestion!\n\nHave fun!');
      break;
    /*
    case '/start':
      b.sendMessage(msg.chat.id, 'To start a game, type /new');
      break;
    */
    case '/new':
      if (!isNew) {
        b.sendMessage(msg.chat.id, 'A game is already in progress');
      } else {
        newRound(game);
      }
      break;
    case '/skip':
      skipList(game.list);
      getScores(game);
      newRound(game);
      break;
    case '/scores':
      getScores(game);
      break;
    case '/list':
      try {
        getList(game, function(list) {
          b.sendMessage(msg.chat.id, '<b>' + game.list.name + '</b> by ' + game.list.creator.username + '\n' + list);
        });
      } catch (e) {

      }
      break;
    /*
    case '/stop':
      delete games[msg.chat.id];
      b.sendMessage(msg.chat.id, 'Game stopped');
      break;
    */
    case '/suggest':
      b.sendMessage('592503547', JSON.stringify((msg.from.username ? msg.from.username : msg.from.first_name) + ': ' + msg.text));
      break;
    case '/hint':
      hint(game, function(hints) {
        b.sendMessage(msg.chat.id, hints);
      });
      break;
    default:
      guess(game, msg);
  }
  res.sendStatus(200);
}

module.exports = router;
