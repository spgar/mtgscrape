var request = require('request');
var cheerio = require('cheerio');

// Adds a card to cards. Card is raw text like this: '3 Underground Sea'
function addCard(cards, text, isSideboard) {
    var cardText = text.match(/(\d+)\s(.+)$/);
    if (!cardText) {
        throw new Error('Failed to parse card: ' + text);
    }

    var quantity = Number(cardText[1]);
    var name = cardText[2];

    // Two cases:
    // - Updating a card that has already been added (exists in main and sideboard)
    // - Adding a new card to cards
    var findObj = cards.filter(function(obj) {
        return obj.name === name;
    })[0];
    if (findObj) {
        if ((isSideboard && findObj.side !== 0) || (!isSideboard && findObj.main !== 0)) {
            throw new Error('Trying to add the same card twice: ' + name);
        }

        if (isSideboard) {
            findObj.side = quantity;
        } else {
            findObj.main = quantity;
        }
    } else {
        var card = {};
        card.name = name;
        if (isSideboard) {
            card.main = 0;
            card.side = quantity;
        } else {
            card.main = quantity;
            card.side = 0;
        }
        cards.push(card);
    }
}

function dateToURLStr(date) {
    return  (date.getMonth() + 1) + '%2F' + date.getDate() + '%2F' + date.getFullYear();
}

function getScrapeDeckIDsURL(startDate, endDate, iter) {
    var url = 'http://sales.starcitygames.com//deckdatabase/deckshow.php?t%5BT3%5D=3&start=1&finish=8&order_1=finish&order_2=&limit=100&action=Show+Decks&p=1';
    var startDateStr = '&start_date=' + dateToURLStr(startDate);
    var endDateStr = '&end_date=' + dateToURLStr(endDate);
    var startNumStr = '';
    if (iter > 0) {
        startNumStr = '&start_num=' + (iter * 100);
    }
    url = url + startDateStr + endDateStr + startNumStr;
    return url;
}

function processDeckIDPage(deckIDs, startDate, endDate, iter, finishedCB) {
    var url = getScrapeDeckIDsURL(startDate, endDate, iter);

    request(url, function(error, response, html) {
        if (error) {
            throw error;
        }

        var finished = false;
        var $ = cheerio.load(html);

        // Check to see if we've hit the end of the results.
        $('.titletext').filter(function() {
            if ($(this).text().indexOf('There were no decks matching that criteria.') !== -1) {
                finished = true;
            }
        });

        if (finished) {
            // All done.
            finishedCB(deckIDs);
        } else {
            // Pull all of the deckIDs into our list.
            $('.deckdbbody > a, .deckdbbody2 > a').each(function(i, e) {
                var link = $(this).attr('href');
                if (link) {
                    var linkMatch = link.match(/DeckID=(\d+)/);
                    if (linkMatch) {
                        deckIDs.push(linkMatch[1]);
                    }
                }
            });

            // Process the next potential) page worth of results.
            processDeckIDPage(deckIDs, startDate, endDate, iter + 1, finishedCB);
        }
    });
}

module.exports = {
    scrapeDeckIDs: function(startDate, endDate, cb) {
        var deckIDs = [];
        processDeckIDPage(deckIDs, startDate, endDate, 0, function(deckIDs) {
            var json = { deckIDs: deckIDs };
            cb(json);
        });
    },

    scrapeDeck: function(deckID, cb) {
        // Create the URL
        var url = 'http://sales.starcitygames.com//deckdatabase/displaydeck.php?DeckID=' + deckID;

        request(url, function(error, response, html) {
            if (error) {
                throw error;
            }

            var $ = cheerio.load(html);

            var deckName, playerName, place, date;
            var cards = [];
            var json = { deckName: '', playerName: '', date: new Date(), place: 0, cards: [] };

            // Extract the deck title
            $('.deck_title').filter(function() {
                deckName = $(this).text();
            });

            // Extract the player's name
            $('.player_name').filter(function() {
                playerName = $(this).text();
            });

            // Extract the deck place and date
            $('.deck_played_placed').filter(function() {
                var data = $(this);
                var placeText = data.text().match(/(\d)(st|nd|rd|th)\sPlace/);
                if (placeText) {
                    place = Number(placeText[1]);
                } else {
                    throw new Error('Failed to extract deck place: ' + data.text());
                }

                var dateText = data.text().match(/on\s(\d+)\/(\d+)\/(\d\d\d\d)/);
                if (dateText) {
                    date = new Date(dateText[3], dateText[1] - 1, dateText[2]);
                } else {
                    throw new Error('Failed to extract date: ' + data.text());
                }
            });

            // Add cards to the main deck
            $('.cards_col1 li, .cards_col2 > ul li').each(function(i, e) {
                addCard(cards, $(this).text(), false);
            });

            // And the sideboard
            $('.deck_sideboard li').each(function(i, e) {
                addCard(cards, $(this).text(), true);
            });

            // Add everything to the json and then return
            json.deckName = deckName;
            json.playerName = playerName;
            json.date = date;
            json.place = place;
            json.cards = cards;

            cb(json);
        });
    }
};
