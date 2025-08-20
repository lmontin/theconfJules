document.addEventListener('DOMContentLoaded', () => {
    loadGameData();
});

let gameData = {};
let gameState;

async function loadGameData() {
    try {
        const response = await fetch('gameData.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        gameData = await response.json();
        console.log('Game data loaded successfully:', gameData);
        initializeGame();
    } catch (error)
        {
        console.error('Could not load game data:', error);
    }
}

class GameState {
    constructor(data) {
        this.gameData = data;
        this.characterLocations = {}; // characterId -> regionId
        this.regionOccupants = {}; // regionId -> { Fellowship: [], Sauron: [] }
        this.players = {
            Fellowship: { hand: [], deck: [], discard: [] },
            Sauron: { hand: [], deck: [], discard: [] }
        };
        this.turn = 'Sauron';
        this.round = 1;
        this.battle = null;
        this.revealedSauronCharacters = new Set();

        this._setupInitialState();
    }

    _setupInitialState() {
        // Setup Regions
        this.gameData.regions.forEach(r => {
            this.regionOccupants[r.id] = { Fellowship: [], Sauron: [] };
        });

        // Setup Characters
        const fellowshipStartingRegions = {
            'CHAR_FELLOWSHIP_FRODO': 'REGION_THE_SHIRE', 'CHAR_FELLOWSHIP_SAM': 'REGION_THE_SHIRE',
            'CHAR_FELLOWSHIP_PIPPIN': 'REGION_THE_SHIRE', 'CHAR_FELLOWSHIP_MERRY': 'REGION_THE_SHIRE',
            'CHAR_FELLOWSHIP_GANDALF': 'REGION_ARTHEDAIN', 'CHAR_FELLOWSHIP_ARAGORN': 'REGION_CARDOLAN',
            'CHAR_FELLOWSHIP_LEGOLAS': 'REGION_EREGION', 'CHAR_FELLOWSHIP_GIMLI': 'REGION_RHUDAUR',
            'CHAR_FELLOWSHIP_BOROMIR': 'REGION_ENEDWAITH',
        };
        const sauronStartingRegions = {
            'CHAR_SAURON_BALROG': 'REGION_MORDOR', 'CHAR_SAURON_SHELOB': 'REGION_MORDOR',
            'CHAR_SAURON_WITCHKING': 'REGION_MORDOR', 'CHAR_SAURON_FLYING_NAZGUL': 'REGION_MORDOR',
            'CHAR_SAURON_BLACK_RIDER': 'REGION_MIRKWOOD', 'CHAR_SAURON_SARUMAN': 'REGION_FANGORN',
            'CHAR_SAURON_ORCS': 'REGION_ROHAN', 'CHAR_SAURON_WARG': 'REGION_DAGORLAD',
            'CHAR_SAURON_CAVE_TROLL': 'REGION_GONDOR',
        };

        this.gameData.characters.forEach(character => {
            const startingRegionId = character.faction === 'Fellowship'
                ? fellowshipStartingRegions[character.id]
                : sauronStartingRegions[character.id];

            this.characterLocations[character.id] = startingRegionId;
            this.regionOccupants[startingRegionId][character.faction].push(character.id);
        });

        // Setup Cards
        this.players.Fellowship.hand = this.gameData.combatCards.filter(c => c.faction === 'Fellowship');
        this.players.Sauron.hand = this.gameData.combatCards.filter(c => c.faction === 'Sauron');
    }

    getCharacter(characterId) {
        return this.gameData.characters.find(c => c.id === characterId);
    }

    getRegion(regionId) {
        return this.gameData.regions.find(r => r.id === regionId);
    }

    getLegalMoves(characterId) {
        const character = this.getCharacter(characterId);
        const sourceRegionId = this.characterLocations[characterId];
        const sourceRegion = this.getRegion(sourceRegionId);
        let legalMoves = new Set();

        if (!character || !sourceRegion) return [];

        // --- Standard Moves ---
        let potentialDestinations = [];
        if (character.faction === 'Fellowship') {
            potentialDestinations.push(...(sourceRegion.fellowshipAdjacent || []));
            potentialDestinations.push(...(sourceRegion.fellowshipSpecialForward || []));
        } else { // Sauron
            potentialDestinations.push(...(sourceRegion.sauronAdjacent || []));
        }

        for (const destId of potentialDestinations) {
            legalMoves.add(destId);
        }

        // --- Ability-Based Moves ---
        const abilities = character.versions.classic.abilities;
        for (const ability of abilities) {
            if (ability.trigger === 'CHECK_MOVE_LEGALITY') {
                const specialMoves = this.getAbilityMoves(ability.id, character, sourceRegion);
                specialMoves.forEach(move => legalMoves.add(move));
            }
        }

        // --- Final Filtering (Capacity) ---
        return Array.from(legalMoves).filter(destId => {
            const destRegion = this.getRegion(destId);
            if (!destRegion) return false;
            const factionOccupants = this.regionOccupants[destId][character.faction];
            return factionOccupants.length < destRegion.factionCapacity;
        });
    }

    getAbilityMoves(abilityId, character, sourceRegion) {
        let moves = [];
        const allRegions = this.gameData.regions;

        switch (abilityId) {
            case 'ARAGORN_SPECIAL_ATTACK_MOVE':
                // Can move to any adjacent region if attacking
                const allAdjacent = this.getAllAdjacentRegions(sourceRegion.id);
                for (const regionId of allAdjacent) {
                    if (this.regionOccupants[regionId]['Sauron'].length > 0) {
                        moves.push(regionId);
                    }
                }
                break;

            case 'WITCHKING_SIDEWAYS_ATTACK':
                // Can move sideways if attacking (not in mountains)
                if (!sourceRegion.special?.includes('Mountains')) {
                    const sideways = this.getSidewaysRegions(sourceRegion.id);
                    for (const regionId of sideways) {
                        if (this.regionOccupants[regionId]['Fellowship'].length > 0) {
                            moves.push(regionId);
                        }
                    }
                }
                break;

            case 'FLYING_NAZGUL_SPECIAL_MOVE':
                // Move to any region with a single Fellowship character
                for (const region of allRegions) {
                    if (this.regionOccupants[region.id]['Fellowship'].length === 1) {
                        moves.push(region.id);
                    }
                }
                // Also sideways in mountains if occupied
                 if (sourceRegion.special?.includes('Mountains')) {
                    const sideways = this.getSidewaysRegions(sourceRegion.id);
                    for (const regionId of sideways) {
                        if (this.regionOccupants[regionId]['Fellowship'].length > 0) {
                            moves.push(regionId);
                        }
                    }
                }
                break;

            case 'BLACK_RIDER_LONG_CHARGE':
                // Move forward any number of regions to attack
                let currentRegion = sourceRegion;
                while (currentRegion) {
                    const forwardRegionId = currentRegion.sauronAdjacent ? currentRegion.sauronAdjacent[0] : null;
                    if (!forwardRegionId) break;

                    const forwardRegion = this.getRegion(forwardRegionId);
                    if (this.regionOccupants[forwardRegionId]['Fellowship'].length > 0) {
                        moves.push(forwardRegionId);
                    }
                     // Stop if the path is blocked by capacity or friendly units
                    if (this.regionOccupants[forwardRegionId]['Sauron'].length >= forwardRegion.factionCapacity) {
                        break;
                    }
                    currentRegion = forwardRegion;
                }
                break;
        }
        return moves;
    }

    getAllAdjacentRegions(regionId) {
        const region = this.getRegion(regionId);
        const adjacent = new Set();
        if (region.fellowshipAdjacent) region.fellowshipAdjacent.forEach(r => adjacent.add(r));
        if (region.sauronAdjacent) region.sauronAdjacent.forEach(r => adjacent.add(r));

        // Also need to find regions that are adjacent TO this one
        this.gameData.regions.forEach(r => {
            if (r.fellowshipAdjacent && r.fellowshipAdjacent.includes(regionId)) adjacent.add(r.id);
            if (r.sauronAdjacent && r.sauronAdjacent.includes(regionId)) adjacent.add(r.id);
        });

        adjacent.delete(regionId);
        return Array.from(adjacent);
    }

    getSidewaysRegions(regionId) {
        const sourceRegion = this.getRegion(regionId);
        const allAdjacent = this.getAllAdjacentRegions(regionId);
        return allAdjacent.filter(adjId => {
            const adjRegion = this.getRegion(adjId);
            return adjRegion.row === sourceRegion.row;
        });
    }

    checkMovementLegality(characterId, destinationRegionId) {
        const legalMoves = this.getLegalMoves(characterId);
        return legalMoves.includes(destinationRegionId);
    }

    moveCharacter(characterId, regionId) {
        if (!this.checkMovementLegality(characterId, regionId)) {
            console.log(`Illegal move for ${this.getCharacter(characterId).name} to ${this.getRegion(regionId).name}`);
            return;
        }

        const oldRegionId = this.characterLocations[characterId];
        const character = this.getCharacter(characterId);

        // Remove from old region
        const oldRegionOccupants = this.regionOccupants[oldRegionId][character.faction];
        this.regionOccupants[oldRegionId][character.faction] = oldRegionOccupants.filter(id => id !== characterId);

        // Add to new region
        this.characterLocations[characterId] = regionId;
        this.regionOccupants[regionId][character.faction].push(characterId);

        console.log(`${character.name} moved from ${oldRegionId} to ${regionId}`);

        this.checkForBattle(regionId);
    }

    checkForBattle(regionId) {
        const occupants = this.regionOccupants[regionId];
        if (occupants.Fellowship.length > 0 && occupants.Sauron.length > 0) {
            console.log(`Battle in ${this.getRegion(regionId).name}!`);
            // For now, just log it. We will implement the full battle sequence next.
            // In a real scenario, we'd pick one defender if multiple are present.
            const attacker = this.turn === 'Sauron' ? occupants.Sauron[0] : occupants.Fellowship[0];
            const defender = this.turn === 'Sauron' ? occupants.Fellowship[0] : occupants.Sauron[0];
            this.initiateBattle(attacker, defender);
        }
    }

    initiateBattle(attackerId, defenderId) {
        this.battle = {
            attackerId: attackerId,
            defenderId: defenderId,
            phase: 'reveal',
            log: []
        };

        // Reveal Sauron character if they are in the battle
        const attacker = this.getCharacter(attackerId);
        const defender = this.getCharacter(defenderId);
        if (attacker.faction === 'Sauron') {
            this.revealedSauronCharacters.add(attackerId);
        }
        if (defender.faction === 'Sauron') {
            this.revealedSauronCharacters.add(defenderId);
        }

        renderCharacters(); // Re-render to show revealed character

        console.log('Battle initiated:', this.battle);
        updateBattlePanel();
        this.battle.phase = 'character_abilities';
        this.resolveBattleStep();
    }

    resolveBattleStep() {
        if (!this.battle) return;

        const phase = this.battle.phase;
        console.log(`Resolving battle phase: ${phase}`);

        if (phase === 'character_abilities') {
            const context = { battle: this.battle, game: this };
            triggerEffects('BATTLE_START', context);

            if (this.battle.retreated) {
                console.log("A character has retreated. Battle ends.");
                this.battle = null;
                renderCharacters();
                return;
            }

            // For now, we just advance to the next phase.
            this.battle.phase = 'card_play';
            this.resolveBattleStep();
        } else if (phase === 'card_play') {
            activateCardSelection();
        } else if (phase === 'resolve_cards') {
            const fellowshipCard = this.battle.fellowshipCard;
            const sauronCard = this.battle.sauronCard;

            if (sauronCard && sauronCard.id === 'CARD_SAURON_EYE_OF_SAURON' && fellowshipCard && fellowshipCard.cardType === 'text') {
                console.log("Eye of Sauron negates Fellowship's text card!");
                this.battle.fellowshipCardNegated = true;
            }

            // Other card effects would be resolved here, in order.

            // Move played cards to discard
            if (fellowshipCard) {
                this.players.Fellowship.hand = this.players.Fellowship.hand.filter(c => c.id !== fellowshipCard.id);
                this.players.Fellowship.discard.push(fellowshipCard);
            }
            if (sauronCard) {
                this.players.Sauron.hand = this.players.Sauron.hand.filter(c => c.id !== sauronCard.id);
                this.players.Sauron.discard.push(sauronCard);
            }

            renderCards(); // Re-render hands
            renderDiscardPiles();

            this.battle.phase = 'compare_strengths';
            this.resolveBattleStep();
        } else if (phase === 'compare_strengths') {
            this.compareStrengths();
            // The battle object is now cleared when the 'Continue' button on the modal is clicked.
        }
    }

    compareStrengths() {
        const attacker = this.getCharacter(this.battle.attackerId);
        const defender = this.getCharacter(this.battle.defenderId);
        const fellowshipCard = this.battle.fellowshipCard;
        const sauronCard = this.battle.sauronCard;

        let attackerStrength = attacker.versions.classic.strength;
        let defenderStrength = defender.versions.classic.strength;

        // Add card strength
        if (fellowshipCard && fellowshipCard.cardType === 'strength') {
            if (attacker.faction === 'Fellowship') attackerStrength += fellowshipCard.strength;
            if (defender.faction === 'Fellowship') defenderStrength += fellowshipCard.strength;
        }
        if (sauronCard && sauronCard.cardType === 'strength') {
            if (attacker.faction === 'Sauron') attackerStrength += sauronCard.strength;
            if (defender.faction === 'Sauron') defenderStrength += sauronCard.strength;
        }

        console.log(`Final Strengths - Attacker: ${attackerStrength}, Defender: ${defenderStrength}`);

        const resultEl = document.getElementById('battle-result');
        let resultMessage = '';

        if (attackerStrength > defenderStrength) {
            this.defeatCharacter(this.battle.defenderId);
            resultMessage = `${attacker.name} defeats ${defender.name}!`;
        } else if (defenderStrength > attackerStrength) {
            this.defeatCharacter(this.battle.attackerId);
            resultMessage = `${defender.name} defeats ${attacker.name}!`;
        } else {
            this.defeatCharacter(this.battle.attackerId);
            this.defeatCharacter(this.battle.defenderId);
            resultMessage = `Both ${attacker.name} and ${defender.name} are defeated!`;
        }

        resultEl.textContent = resultMessage;
        document.getElementById('battle-continue-button').style.display = 'block';
    }

    defeatCharacter(characterId) {
        const character = this.getCharacter(characterId);
        const regionId = this.characterLocations[characterId];

        // Remove from occupants and locations
        const regionOccupants = this.regionOccupants[regionId][character.faction];
        this.regionOccupants[regionId][character.faction] = regionOccupants.filter(id => id !== characterId);
        delete this.characterLocations[characterId];

        console.log(`${character.name} has been defeated.`);
        // Note: We might want to move defeated characters to a "defeated" area in gameState
    }

    switchTurn() {
        // Revealed Sauron characters are hidden again at the end of the turn.
        // A special ability could prevent this, but is not yet implemented.
        this.revealedSauronCharacters.clear();

        if (this.turn === 'Fellowship') {
            this.round++;
            console.log(`--- Round ${this.round} ---`);
        }
        this.turn = this.turn === 'Sauron' ? 'Fellowship' : 'Sauron';
        console.log(`Turn switched to ${this.turn}`);
        renderCharacters(); // Re-render to ensure cards are hidden.
    }
}

// --- Ability System ---
function triggerEffects(event, context) {
    console.log(`Triggering event: ${event}`);

    if (event === 'BATTLE_START') {
        const attacker = context.game.getCharacter(context.battle.attackerId);
        const defender = context.game.getCharacter(context.battle.defenderId);
        const charactersInBattle = [attacker, defender]; // Simplified order

        for (const character of charactersInBattle) {
            const abilities = character.versions.classic.abilities;
            for (const ability of abilities) {
                if (ability.trigger === event) {
                    // In a full implementation, we'd check the condition here.
                    // For now, we assume it's met for demonstration.
                    dispatchAbility(ability.id, character, context);
                }
            }
        }
    }
}

function handleFrodoRetreat(source, context) {
    const { battle, game } = context;
    const isDefending = source.id === battle.defenderId;

    if (source.id === 'CHAR_FELLOWSHIP_FRODO' && isDefending) {
        console.log("Frodo's retreat ability triggered.");
        const currentRegion = game.getRegion(game.characterLocations[source.id]);

        // Find a valid retreat region (sideways, not into mountains, etc.)
        // This is a simplified version. A full implementation needs to check all retreat rules.
        const adjacent = currentRegion.fellowshipAdjacent.map(id => game.getRegion(id));
        const validRetreats = adjacent.filter(r => {
            const isMountain = r.special === 'Mountains'; // Simplified check
            const hasEnemies = game.regionOccupants[r.id].Sauron.length > 0;
            return !isMountain && !hasEnemies;
        });

        if (validRetreats.length > 0) {
            const retreatTo = validRetreats[0]; // Just pick the first one
            console.log(`Frodo retreats to ${retreatTo.name}`);
            game.moveCharacter(source.id, retreatTo.id);
            battle.retreated = true;
        }
    }
}

function dispatchAbility(abilityId, source, context) {
    const handlers = {
        'FRODO_RETREAT': handleFrodoRetreat,
    };

    if (handlers[abilityId]) {
        return handlers[abilityId](source, context);
    }
}

function initializeGame() {
    console.log('Initializing game...');
    gameState = new GameState(gameData);
    gameState.selectedCharacterId = null;
    createGameBoard();
    renderCharacters();
    renderCards();
    renderDiscardPiles();
    updateTurnIndicator();

    document.getElementById('battle-continue-button').addEventListener('click', () => {
        document.getElementById('battle-panel').style.display = 'none';
        document.getElementById('battle-continue-button').style.display = 'none';
        document.getElementById('battle-result').textContent = '';
        document.getElementById('attacker-card').innerHTML = '';
        document.getElementById('defender-card').innerHTML = '';
        gameState.battle = null;
        renderCharacters();

        // After a battle, the turn should switch.
        gameState.switchTurn();
        updateTurnIndicator();
    });
}

function createGameBoard() {
    const gameBoard = document.getElementById('game-board');
    if (!gameBoard) {
        console.error('Game board element not found!');
        return;
    }
    gameBoard.innerHTML = ''; // Clear previous board

    const sortedRegions = gameData.regions.sort((a, b) => {
        if (a.row !== b.row) return a.row - b.row;
        return a.position - b.position;
    });

    const regionsByRow = sortedRegions.reduce((acc, region) => {
        if (!acc[region.row]) {
            acc[region.row] = [];
        }
        acc[region.row].push(region);
        return acc;
    }, {});

    for (const row in regionsByRow) {
        const rowEl = document.createElement('div');
        rowEl.className = 'grid-row';
        regionsByRow[row].forEach(region => {
            const regionEl = document.createElement('div');
            regionEl.id = region.id;
            regionEl.className = 'region';

            const regionNameEl = document.createElement('div');
            regionNameEl.className = 'region-name';
            regionNameEl.textContent = region.name;
            regionEl.appendChild(regionNameEl);

            const charactersContainerEl = document.createElement('div');
            charactersContainerEl.className = 'characters-container';
            regionEl.appendChild(charactersContainerEl);

            regionEl.dataset.region = JSON.stringify(region);

            regionEl.addEventListener('click', () => {
                if (gameState.selectedCharacterId && regionEl.classList.contains('legal-move')) {
                    const characterId = gameState.selectedCharacterId;
                    gameState.moveCharacter(characterId, region.id);

                    // After move, update UI
                    renderCharacters();
                    gameState.selectedCharacterId = null;
                    clearLegalMoveHighlights();

                    // Switch turns
                    gameState.switchTurn();
                    updateTurnIndicator();
                }
            });
            rowEl.appendChild(regionEl);
        });
        gameBoard.appendChild(rowEl);
    }
}

function renderCharacters() {
    // Clear existing characters from the board
    document.querySelectorAll('.character').forEach(el => el.remove());

    for (const characterId in gameState.characterLocations) {
        const regionId = gameState.characterLocations[characterId];
        const character = gameState.getCharacter(characterId);

        const characterEl = document.createElement('div');
        characterEl.id = character.id;
        characterEl.className = `character ${character.faction.toLowerCase()}`;

        const isSauronAndHidden = character.faction === 'Sauron' && !gameState.revealedSauronCharacters.has(character.id);

        if (isSauronAndHidden) {
            characterEl.classList.add('hidden');
        } else {
            const characterName = document.createElement('span');
            const strength = character.versions.classic.strength;
            characterName.textContent = `${character.name} (${strength})`;
            characterEl.appendChild(characterName);

            const abilities = character.versions.classic.abilities.map(a => a.text).join('\n');
            characterEl.title = abilities;
        }

        characterEl.dataset.character = JSON.stringify(character);

        characterEl.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent region click from firing

            // Deselect if clicking the same character
            if (gameState.selectedCharacterId === character.id) {
                gameState.selectedCharacterId = null;
                characterEl.classList.remove('selected');
                clearLegalMoveHighlights();
            } else {
                // Remove selection from others
                document.querySelectorAll('.character.selected').forEach(el => el.classList.remove('selected'));

                gameState.selectedCharacterId = character.id;
                characterEl.classList.add('selected');
                highlightLegalMoves(character.id);
            }
        });

        const regionEl = document.getElementById(regionId);
        const charactersContainer = regionEl.querySelector('.characters-container');

        if (charactersContainer) {
            charactersContainer.appendChild(characterEl);
        } else {
            console.error(`Could not find container for ${character.name} in ${regionId}`);
        }
    }
}

function renderCards() {
    const fellowshipHand = document.getElementById('fellowship-hand');
    const sauronHand = document.getElementById('sauron-hand');
    fellowshipHand.innerHTML = '';
    sauronHand.innerHTML = '';

    gameState.players.Fellowship.hand.forEach(card => {
        const cardEl = createCardElement(card);
        fellowshipHand.appendChild(cardEl);
    });

    gameState.players.Sauron.hand.forEach(card => {
        const cardEl = createCardElement(card);
        sauronHand.appendChild(cardEl);
    });
}

function createCardElement(card) {
    const cardEl = document.createElement('div');
    cardEl.id = card.id;
    cardEl.className = `card ${card.faction.toLowerCase()}`;
    cardEl.dataset.card = JSON.stringify(card);

    const cardName = document.createElement('div');
    cardName.className = 'card-name';
    cardName.textContent = card.name;
    cardEl.appendChild(cardName);

    if (card.cardType === 'strength') {
        const cardStrength = document.createElement('div');
        cardStrength.className = 'card-strength';
        cardStrength.textContent = card.strength;
        cardEl.appendChild(cardStrength);
    } else {
        const cardText = document.createElement('div');
        cardText.className = 'card-text';
        cardText.textContent = card.abilities[0].text;
        cardEl.appendChild(cardText);
    }

    return cardEl;
}

function updateTurnIndicator() {
    const turnIndicator = document.getElementById('turn-indicator');
    turnIndicator.textContent = `Round ${gameState.round} / Turn: ${gameState.turn}`;

    // Add classes to player info sections to highlight the current player
    document.getElementById('fellowship-info').classList.remove('current-turn');
    document.getElementById('sauron-info').classList.remove('current-turn');
    if (gameState.turn === 'Fellowship') {
        document.getElementById('fellowship-info').classList.add('current-turn');
    } else {
        document.getElementById('sauron-info').classList.add('current-turn');
        // If it's Sauron's turn, and no battle is active, let the AI play.
        if (!gameState.battle) {
            setTimeout(playSauronTurn, 1000);
        }
    }
}

function highlightLegalMoves(characterId) {
    clearLegalMoveHighlights();
    const allRegions = document.querySelectorAll('.region');
    allRegions.forEach(regionEl => {
        const regionId = regionEl.id;
        if (gameState.checkMovementLegality(characterId, regionId)) {
            regionEl.classList.add('legal-move');
        }
    });
}

function clearLegalMoveHighlights() {
    document.querySelectorAll('.region.legal-move').forEach(el => {
        el.classList.remove('legal-move');
    });
}

function renderDiscardPiles() {
    const fellowshipDiscard = document.getElementById('fellowship-discard');
    const sauronDiscard = document.getElementById('sauron-discard');
    fellowshipDiscard.innerHTML = '';
    sauronDiscard.innerHTML = '';

    gameState.players.Fellowship.discard.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.classList.remove('selected'); // Just in case
        fellowshipDiscard.appendChild(cardEl);
    });

    gameState.players.Sauron.discard.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.classList.remove('selected');
        sauronDiscard.appendChild(cardEl);
    });
}

function updateBattlePanel() {
    const battle = gameState.battle;
    const panel = document.getElementById('battle-panel');
    if (!battle) {
        panel.style.display = 'none';
        return;
    }

    const attacker = gameState.getCharacter(battle.attackerId);
    const defender = gameState.getCharacter(battle.defenderId);
    const location = gameState.getRegion(gameState.characterLocations[battle.attackerId]);

    document.getElementById('battle-location').textContent = `Battle at ${location.name}`;

    // Attacker info
    document.getElementById('attacker-name').textContent = attacker.name;
    document.getElementById('attacker-strength').textContent = attacker.versions.classic.strength;
    document.getElementById('attacker-ability').textContent = attacker.versions.classic.abilities.map(a => a.text).join(', ');

    // Defender info
    document.getElementById('defender-name').textContent = defender.name;
    document.getElementById('defender-strength').textContent = defender.versions.classic.strength;
    document.getElementById('defender-ability').textContent = defender.versions.classic.abilities.map(a => a.text).join(', ');

    panel.style.display = 'block';
}

function activateCardSelection() {
    const confirmButton = document.getElementById('confirm-play-button');
    confirmButton.style.display = 'block';

    const playerHand = document.getElementById('fellowship-hand'); // Assuming human is always Fellowship
    const cards = playerHand.querySelectorAll('.card');

    cards.forEach(card => {
        const clickHandler = () => {
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        };
        card.addEventListener('click', clickHandler);
        card.clickHandler = clickHandler; // Store for removal
    });

    confirmButton.addEventListener('click', function onConfirm() {
        const selectedCardEl = playerHand.querySelector('.card.selected');
        if (!selectedCardEl) {
            alert('Please select a card to play.');
            return;
        }

        const fellowshipCard = JSON.parse(selectedCardEl.dataset.card);
        gameState.battle.fellowshipCard = fellowshipCard;

        // AI selects a random card
        const sauronHand = gameState.players.Sauron.hand;
        const sauronCard = sauronHand[Math.floor(Math.random() * sauronHand.length)];
        gameState.battle.sauronCard = sauronCard;

        console.log(`Fellowship plays: ${fellowshipCard.name}, Sauron plays: ${sauronCard.name}`);

        // Update modal with played cards
        const attackerCardContainer = document.getElementById('attacker-card');
        const defenderCardContainer = document.getElementById('defender-card');
        attackerCardContainer.innerHTML = '';
        defenderCardContainer.innerHTML = '';

        const attacker = gameState.getCharacter(gameState.battle.attackerId);
        if (attacker.faction === 'Fellowship') {
            attackerCardContainer.appendChild(createCardElement(fellowshipCard));
            defenderCardContainer.appendChild(createCardElement(sauronCard));
        } else {
            attackerCardContainer.appendChild(createCardElement(sauronCard));
            defenderCardContainer.appendChild(createCardElement(fellowshipCard));
        }

        // Cleanup
        confirmButton.style.display = 'none';
        cards.forEach(card => card.removeEventListener('click', card.clickHandler));
        selectedCardEl.classList.remove('selected');
        confirmButton.removeEventListener('click', onConfirm);

        // Advance game
        gameState.battle.phase = 'resolve_cards';
        gameState.resolveBattleStep();
    });
}

function playSauronTurn() {
    console.log("Sauron is thinking...");

    const sauronCharacters = Object.keys(gameState.characterLocations).filter(id =>
        gameState.getCharacter(id).faction === 'Sauron'
    );

    const allMoves = [];
    for (const characterId of sauronCharacters) {
        for (const region of gameData.regions) {
            if (gameState.checkMovementLegality(characterId, region.id)) {
                allMoves.push({ characterId, regionId: region.id });
            }
        }
    }

    const attackMoves = allMoves.filter(move =>
        gameState.regionOccupants[move.regionId].Fellowship.length > 0
    );

    let chosenMove = null;
    if (attackMoves.length > 0) {
        console.log("Sauron found attack moves:", attackMoves);
        chosenMove = attackMoves[Math.floor(Math.random() * attackMoves.length)];
    } else if (allMoves.length > 0) {
        console.log("Sauron found non-attack moves:", allMoves);
        chosenMove = allMoves[Math.floor(Math.random() * allMoves.length)];
    }

    if (chosenMove) {
        console.log("Sauron chose move:", chosenMove);
        gameState.moveCharacter(chosenMove.characterId, chosenMove.regionId);
        renderCharacters();
    } else {
        console.log("Sauron has no legal moves.");
    }

    // Switch turn back to Fellowship
    if (!gameState.battle) { // Don't switch turn if a battle was initiated
        gameState.switchTurn();
        updateTurnIndicator();
    }
}
