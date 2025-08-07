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

    if (failures === 0) {
        testResultsEl.innerHTML = '<h2>All tests passed!</h2>' + testResultsEl.innerHTML;
    } else {
        testResultsEl.innerHTML = `<h2>${failures} test(s) failed.</h2>` + testResultsEl.innerHTML;
    }
}
