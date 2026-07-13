import streamDeck from "@elgato/streamdeck";

import { CurrentMeeting, NextMeeting } from "./actions/countdown";

// Keep normal logging; use "trace"/"debug" while debugging the Stream Deck <-> plugin protocol.
streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new NextMeeting());
streamDeck.actions.registerAction(new CurrentMeeting());

streamDeck.connect();
