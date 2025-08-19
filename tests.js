document.addEventListener('DOMContentLoaded', () => {
    runTests();
});

function runTests() {
    const testResultsEl = document.getElementById('test-results');
    let failures = 0;

    function test(name, fn) {
        try {
            fn();
            testResultsEl.innerHTML += `<p style="color: green;">✔ ${name}</p>`;
        } catch (e) {
            failures++;
            testResultsEl.innerHTML += `<p style="color: red;">✖ ${name}: ${e.message}</p>`;
            console.error(e);
        }
    }

    test('Game board should be rendered', () => {
        const gameBoard = document.getElementById('game-board');
        console.assert(gameBoard, 'Game board element should exist');
        console.assert(gameBoard.children.length > 0, 'Game board should have child elements (regions)');
    });

    test('All regions should be rendered', () => {
        const regions = document.querySelectorAll('.region');
        const expectedRegionCount = gameData.regions.length;
        console.assert(regions.length === expectedRegionCount, `Expected ${expectedRegionCount} regions, but found ${regions.length}`);
    });

    test('All characters should be rendered', () => {
        const characters = document.querySelectorAll('.character');
        const expectedCharacterCount = gameData.characters.length;
        console.assert(characters.length === expectedCharacterCount, `Expected ${expectedCharacterCount} characters, but found ${characters.length}`);
    });

    test('Fellowship hand should have the correct number of cards', () => {
        const fellowshipHand = document.getElementById('fellowship-hand');
        const expectedCardCount = gameData.combatCards.filter(c => c.faction === 'Fellowship').length;
        console.assert(fellowshipHand.children.length === expectedCardCount, `Expected ${expectedCardCount} cards in Fellowship hand, but found ${fellowshipHand.children.length}`);
    });

    test('Sauron hand should have the correct number of cards', () => {
        const sauronHand = document.getElementById('sauron-hand');
        const expectedCardCount = gameData.combatCards.filter(c => c.faction === 'Sauron').length;
        console.assert(sauronHand.children.length === expectedCardCount, `Expected ${expectedCardCount} cards in Sauron hand, but found ${sauronHand.children.length}`);
    });

    // --- Movement Tests ---

    test('Fellowship Basic Movement', () => {
        const localGameState = new GameState(gameData);
        const frodoId = 'CHAR_FELLOWSHIP_FRODO';
        const legalMoves = localGameState.getLegalMoves(frodoId);
        console.assert(legalMoves.includes('REGION_ARTHEDAIN'), "Frodo should be able to move to Arthedain");
        console.assert(legalMoves.includes('REGION_CARDOLAN'), "Frodo should be able to move to Cardolan");
        console.assert(legalMoves.length === 2, "Frodo should have exactly 2 legal moves");
    });

    test('Sauron Basic Movement', () => {
        const localGameState = new GameState(gameData);
        const witchKingId = 'CHAR_SAURON_WITCHKING';
        localGameState.characterLocations[witchKingId] = 'REGION_DAGORLAD'; // Place Witch-king
        const legalMoves = localGameState.getLegalMoves(witchKingId);
        console.assert(legalMoves.includes('REGION_MIRKWOOD'), "Witch-king should be able to move to Mirkwood");
        console.assert(legalMoves.includes('REGION_FANGORN'), "Witch-king should be able to move to Fangorn");
    });

    test('Region Capacity Limit', () => {
        const localGameState = new GameState(gameData);
        const gandalfId = 'CHAR_FELLOWSHIP_GANDALF';
        const aragornId = 'CHAR_FELLOWSHIP_ARAGORN';
        const legolasId = 'CHAR_FELLOWSHIP_LEGOLAS';
        const arthedainId = 'REGION_ARTHEDAIN';

        // Arthedain has capacity of 2 for Fellowship
        localGameState.regionOccupants[arthedainId]['Fellowship'] = [gandalfId, aragornId];

        // Try to move Legolas from Eregion to Arthedain
        localGameState.characterLocations[legolasId] = 'REGION_EREGION';
        const legalMoves = localGameState.getLegalMoves(legolasId);

        console.assert(!legalMoves.includes(arthedainId), "Legolas should not be able to move to a full Arthedain");
    });

    test('Fellowship Special Path (Tunnel of Moria)', () => {
        const localGameState = new GameState(gameData);
        const legolasId = 'CHAR_FELLOWSHIP_LEGOLAS';
        localGameState.characterLocations[legolasId] = 'REGION_EREGION';
        const legalMoves = localGameState.getLegalMoves(legolasId);
        console.assert(legalMoves.includes('REGION_FANGORN'), "Legolas should be able to use the Tunnel of Moria to Fangorn");
    });

    test("Aragorn's Special Attack Move", () => {
        const localGameState = new GameState(gameData);
        const aragornId = 'CHAR_FELLOWSHIP_ARAGORN';
        const witchKingId = 'CHAR_SAURON_WITCHKING';

        // Place Aragorn in Eregion and Witch-king in Cardolan (sideways)
        localGameState.characterLocations[aragornId] = 'REGION_EREGION';
        localGameState.regionOccupants['REGION_EREGION']['Fellowship'] = [aragornId];
        localGameState.characterLocations[witchKingId] = 'REGION_CARDOLAN';
        localGameState.regionOccupants['REGION_CARDOLAN']['Sauron'] = [witchKingId];

        const legalMoves = localGameState.getLegalMoves(aragornId);
        console.assert(legalMoves.includes('REGION_CARDOLAN'), "Aragorn should be able to attack Cardolan sideways");
    });

    test("Witch-king's Sideways Attack", () => {
        const localGameState = new GameState(gameData);
        const witchKingId = 'CHAR_SAURON_WITCHKING';
        const gandalfId = 'CHAR_FELLOWSHIP_GANDALF';

        // Place Witch-king in Mirkwood and Gandalf in Fangorn (sideways)
        localGameState.characterLocations[witchKingId] = 'REGION_MIRKWOOD';
        localGameState.regionOccupants['REGION_MIRKWOOD']['Sauron'] = [witchKingId];
        localGameState.characterLocations[gandalfId] = 'REGION_FANGORN';
        localGameState.regionOccupants['REGION_FANGORN']['Fellowship'] = [gandalfId];

        const legalMoves = localGameState.getLegalMoves(witchKingId);
        console.assert(legalMoves.includes('REGION_FANGORN'), "Witch-king should be able to attack Fangorn sideways");
    });

    test("Flying Nazgûl's Special Move", () => {
        const localGameState = new GameState(gameData);
        const nazgulId = 'CHAR_SAURON_FLYING_NAZGUL';
        const frodoId = 'CHAR_FELLOWSHIP_FRODO';

        // Nazgul in Mordor, Frodo alone in The Shire
        localGameState.characterLocations[nazgulId] = 'REGION_MORDOR';
        localGameState.characterLocations[frodoId] = 'REGION_THE_SHIRE';
        localGameState.regionOccupants['REGION_THE_SHIRE']['Fellowship'] = [frodoId]; // Only Frodo

        const legalMoves = localGameState.getLegalMoves(nazgulId);
        console.assert(legalMoves.includes('REGION_THE_SHIRE'), "Flying Nazgul should be able to fly to The Shire to attack Frodo");
    });

    test("Black Rider's Long Charge", () => {
        const localGameState = new GameState(gameData);
        const riderId = 'CHAR_SAURON_BLACK_RIDER';
        const frodoId = 'CHAR_FELLOWSHIP_FRODO';

        // Rider in Mirkwood, Frodo in Mordor (long charge)
        localGameState.characterLocations[riderId] = 'REGION_MIRKWOOD';
        localGameState.characterLocations[frodoId] = 'REGION_MORDOR';
        localGameState.regionOccupants['REGION_MORDOR']['Fellowship'] = [frodoId];

        const legalMoves = localGameState.getLegalMoves(riderId);
        console.log("Black Rider moves:", legalMoves);
        console.assert(legalMoves.includes('REGION_MORDOR'), "Black Rider should be able to long charge to Mordor");
    });


    if (failures === 0) {
        testResultsEl.innerHTML = '<h2>All tests passed!</h2>' + testResultsEl.innerHTML;
    } else {
        testResultsEl.innerHTML = `<h2>${failures} test(s) failed.</h2>` + testResultsEl.innerHTML;
    }
}
