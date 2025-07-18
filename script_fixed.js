document.addEventListener('DOMContentLoaded', () => { // Corrected: 'document' is lowercase
    // --- DOM Elements ---
    const chessboard = document.getElementById('chessboard');
    const gameControls = document.getElementById('game-controls');
    const startButton = document.getElementById('start-game');
    const whiteChoice = document.getElementById('choose-white');
    const blackChoice = document.getElementById('choose-black');
    const randomChoice = document.getElementById('choose-random');
    const turnDisplay = document.getElementById('turn-display');
    const fenDisplay = document.getElementById('fen-display');
    const gameStatus = document.getElementById('game-status');
    const startBotVsBotButton = document.getElementById('start-bot-vs-bot');
    const promotionGui = document.getElementById('promotion-gui');
    const promotionOptions = document.getElementById('promotion-options');
    const easyDifficultyBtn = document.getElementById('difficulty-easy');
    const mediumDifficultyBtn = document.getElementById('difficulty-medium');
    const hardDifficultyBtn = document.getElementById('difficulty-hard');
    // NEW: Move History Panel Elements
    const moveHistoryPanel = document.getElementById('move-history-panel');
    const moveList = document.getElementById('move-list');

    // NEW: Game action buttons
    const gameActions = document.getElementById('game-actions');
    const resignButton = document.getElementById('resign-button');
    const postGameOptions = document.getElementById('post-game-options');
    const rematchButton = document.getElementById('rematch-button');
    const returnToMenuButton = document.getElementById('return-to-menu-button');


    // --- Game Variables ---
    const boardSize = 8;
    const game = new Chess(); // Ensure Chess is defined from chess.min.js loaded BEFORE this script
    let currentPlayer = 'white';
    let humanPlayerColor = '';
    let gameStarted = false;
    let selectedSquareId = null;
    let stockfish = null;
    let botVsBotMode = false;
    let pendingPromotion = null;
    let botDifficulty = 'medium';
    let botDepth = 8;
    // NEW: Game History Variables
    let gameHistoryStates = []; // Stores { fen: "...", pgn: "..." } for each half-move
    let currentHistoryIndex = -1; // Tracks current position in historyStates


    const pieceUnicodeMap = {
        'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔',
        'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚'
    };

    // --- Helper Functions ---

    function createBoard() {
        chessboard.innerHTML = '';
        const currentBoard = game.board();

        // Use the remembered information for POV.
        // from White’s POV: a–h (left to right), ranks 1–8 (bottom to top)
        // from Black’s POV: ranks and files are flipped (ranks 8–1, files h–a)
        const isPlayerWhitePOV = (humanPlayerColor === 'white' || botVsBotMode || humanPlayerColor === '') && currentHistoryIndex === gameHistoryStates.length - 1;
        const isPlayerBlackPOV = humanPlayerColor === 'black' && currentHistoryIndex === gameHistoryStates.length - 1;

        // Flip the board visually if Black POV
        if (isPlayerBlackPOV) {
            chessboard.classList.add('flipped');
        } else {
            chessboard.classList.remove('flipped');
        }

        const rowIndices = [...Array(boardSize).keys()];
        const colIndices = [...Array(boardSize).keys()];
        if (isPlayerBlackPOV) {
            rowIndices.reverse();
            colIndices.reverse();
        }

        for (let i of rowIndices) {
            for (let j of colIndices) {
                const square = document.createElement('div');
                square.classList.add('square');

                const isLight = (i + j) % 2 === 0;
                square.classList.add(isLight ? 'light' : 'dark');

                // Correct square ID logic based on POV (this was the tricky part before)
                let file, rank;
                if (isPlayerBlackPOV) {
                    file = String.fromCharCode(97 + (boardSize - 1 - j)); // Flip file for ID (h becomes a, g becomes b, etc.)
                    rank = i + 1; // Ranks are 1-8, but reversed in the loop for Black's POV
                } else {
                    file = String.fromCharCode(97 + j);
                    rank = 8 - i;
                }
                square.dataset.file = file;
                square.dataset.rank = rank;
                square.id = `${file}${rank}`;

                // Map to logical board index for pieces (this remains consistent with chess.js internal board)
                const boardRow = isPlayerBlackPOV ? boardSize - 1 - i : i; // Row 0 is rank 8, Row 7 is rank 1
                const boardCol = isPlayerBlackPOV ? boardSize - 1 - j : j; // Col 0 is file a, Col 7 is file h

                const piece = currentBoard[boardRow][boardCol];
                if (piece && typeof piece.type === 'string') {
                    square.textContent = pieceUnicodeMap[piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()];
                    square.classList.add(piece.color === 'w' ? 'white-piece' : 'black-piece');
                }

                if (!botVsBotMode) {
                    square.addEventListener('click', handleSquareClick);
                }

                chessboard.appendChild(square);
            }
        }

        updateCheckHighlight();
    }

    function updateCheckHighlight() {
        document.querySelectorAll('.in-check-king').forEach(sq => sq.classList.remove('in-check-king'));

        if (game.in_check()) {
            const kingColor = game.turn();
            let kingSquareId = '';

            const board = game.board();
            for (let r = 0; r < boardSize; r++) {
                for (let c = 0; c < boardSize; c++) {
                    const piece = board[r][c];
                    if (piece && piece.type === 'k' && piece.color === kingColor) {
                        const file = String.fromCharCode(97 + c);
                        const rank = 8 - r;
                        kingSquareId = `${file}${rank}`;
                        break;
                    }
                }
                if (kingSquareId) break;
            }

            if (kingSquareId) {
                const kingSquareElement = document.getElementById(kingSquareId);
                if (kingSquareElement) {
                    kingSquareElement.classList.add('in-check-king');
                }
            }
        }
    }

    function updateFenDisplay() {
        fenDisplay.textContent = `FEN: ${game.fen()}`;
    }

    function getGameResult() {
        if (game.in_checkmate()) {
            return `Checkmate! ${game.turn() === 'w' ? 'Black' : 'White'} wins!`;
        } else if (game.in_draw()) {
            if (game.in_stalemate()) return "Stalemate!";
            if (game.in_threefold_repetition()) return "Draw by Threefold Repetition!";
            if (game.fifty_moves()) return "Draw by Fifty-move Rule!";
            return "Draw!";
        }
        return "Game ongoing.";
    }

    // NEW: Helper to add move to history array and update panel
    function recordMoveAndHistory(moveObject) {
        // If we're not at the latest move, truncate history before adding new move
        if (currentHistoryIndex < gameHistoryStates.length - 1) {
            gameHistoryStates.splice(currentHistoryIndex + 1);
        }

        // Only push if moveObject is valid and has a 'san' property
        if (moveObject && moveObject.san) {
            gameHistoryStates.push({
                fen: game.fen(),
                pgn: moveObject.san
            });
            currentHistoryIndex = gameHistoryStates.length - 1; // Update current index
            updateMoveHistoryPanel();
        } else {
            console.warn("Attempted to record an invalid or null move object:", moveObject);
        }
    }

    // NEW: Update and render the move history panel
    function updateMoveHistoryPanel() {
        moveList.innerHTML = ''; // Clear existing list
        let moveNumber = 1;

        gameHistoryStates.forEach((state, index) => {
            const isWhitesMoveInHistory = (index % 2 === 0);
            let li;

            if (isWhitesMoveInHistory) {
                li = document.createElement('li');
                li.classList.add('move-item');
                const moveNumSpan = document.createElement('span');
                moveNumSpan.classList.add('move-number');
                moveNumSpan.textContent = `${moveNumber}.`;
                li.appendChild(moveNumSpan);
                
                const whiteMoveTextSpan = document.createElement('span');
                whiteMoveTextSpan.classList.add('move-text');
                whiteMoveTextSpan.textContent = state.pgn;
                li.appendChild(whiteMoveTextSpan);
                
                moveList.appendChild(li);
                
                if (gameHistoryStates[index + 1]) { // If there's a corresponding Black move
                    const blackMoveTextSpan = document.createElement('span');
                    blackMoveTextSpan.classList.add('move-text');
                    blackMoveTextSpan.textContent = ` ${gameHistoryStates[index + 1].pgn}`;
                    li.appendChild(blackMoveTextSpan);
                }
                moveNumber++;
            } else if (index > 0 && !isWhitesMoveInHistory) {
                // This else-if is mostly redundant due to how move pairs are handled above,
                // but kept for clarity regarding individual half-moves.
            }


            // Set dataset index for all list items, and highlight current
            const actualLiElements = moveList.querySelectorAll('.move-item');
            actualLiElements.forEach((item, liIndex) => {
                // A single li element now represents a full move (White's + Black's)
                // So, liIndex 0 -> gameHistoryStates index 0 (White) and 1 (Black)
                // liIndex 1 -> gameHistoryStates index 2 (White) and 3 (Black)
                // We'll mark the li based on the first move in its pair
                const stateIndexForLi = liIndex * 2;
                item.dataset.index = stateIndexForLi; // Index of White's move in the pair

                // Highlight the li if either the white or black move within it is the current move
                if (currentHistoryIndex === stateIndexForLi || currentHistoryIndex === stateIndexForLi + 1) {
                    item.classList.add('current-move');
                } else {
                    item.classList.remove('current-move');
                }
                
                item.onclick = () => jumpToMove(stateIndexForLi); // Click event to jump to White's move of the pair
            });
        });
        // Scroll to bottom to see latest moves
        moveHistoryPanel.scrollTop = moveHistoryPanel.scrollHeight;
    }


    // NEW: Function to jump to a specific point in game history
    function jumpToMove(index) {
        if (index < 0 || index >= gameHistoryStates.length) {
            console.warn("Invalid history index:", index);
            return;
        }

        currentHistoryIndex = index;
        const targetFen = gameHistoryStates[index].fen;
        game.load(targetFen); // Load the historical FEN

        createBoard(); // Re-render board with correct orientation
        updateFenDisplay();
        gameStatus.textContent = getGameResult();

        // Update turn display when viewing history
        if (currentHistoryIndex < gameHistoryStates.length - 1) {
            turnDisplay.textContent = `Current Turn: ${game.turn() === 'w' ? 'WHITE' : 'BLACK'} (Viewing History)`;
        } else {
            // If jumped to the end of history, restore normal turn display
            turnDisplay.textContent = `Current Turn: ${currentPlayer.toUpperCase()} (${botVsBotMode ? 'Bot vs Bot' : `You are ${humanPlayerColor.toUpperCase()}`})`;
        }


        updateMoveHistoryPanel(); // Update highlights in history panel

        // If back at current move and it's bot's turn, trigger bot move
        if (currentHistoryIndex === gameHistoryStates.length - 1 && gameStarted && (botVsBotMode || currentPlayer !== humanPlayerColor)) {
            setTimeout(makeBotMove, botVsBotMode ? 1000 : 500);
        }
    }


    function commonGameSetup() {
        gameStarted = true;
        gameControls.style.display = 'none';
        chessboard.style.display = 'grid'; // Ensure chessboard is displayed
        turnDisplay.style.display = 'block';
        fenDisplay.style.display = 'block';
        gameStatus.style.display = 'block';
        moveHistoryPanel.style.display = 'block'; // Show history panel
        gameActions.style.display = 'flex'; // NEW: Show resign button during game
        postGameOptions.style.display = 'none'; // NEW: Hide post-game options
        promotionGui.style.display = 'none'; // Hide promotion GUI

        game.reset();
        gameHistoryStates = []; // Clear history for new game
        currentHistoryIndex = -1;
        currentPlayer = 'white';
        gameStatus.textContent = "Game ongoing.";
        createBoard(); // Call createBoard here to set initial orientation
        updateFenDisplay();
        updateMoveHistoryPanel(); // Initialize empty history panel

        if (stockfish === null) {
            stockfish = new Worker('stockfish.js'); // Make sure stockfish.js is in the same folder

            stockfish.onmessage = function(event) {
                const line = event.data;

                if (line.startsWith('bestmove')) {
                    const moveStr = line.split(' ')[1];
                    console.log('Bot wants to move:', moveStr);

                    const from = moveStr.substring(0, 2);
                    const to = moveStr.substring(2, 4);
                    const promotion = moveStr.length === 5 ? moveStr.substring(4, 5) : undefined;

                    let moveApplied = false;
                    let permanentMoveResult = game.move({ from: from, to: to, promotion: promotion });

                    if (permanentMoveResult) {
                        recordMoveAndHistory(permanentMoveResult); // Record the bot's move
                        moveApplied = true;
                    } else {
                        console.warn("Bot's suggested move failed to apply:", moveStr, "Attempting sloppy move...");
                        // Fallback: try sloppy move
                        const fallbackMoveResult = game.move({ from: from, to: to, promotion: promotion }, { sloppy: true });
                        if (fallbackMoveResult) {
                            recordMoveAndHistory(fallbackMoveResult);
                            moveApplied = true;
                        } else {
                            console.error("Even sloppy move failed for bot's move. Board might be stuck or bot suggested an truly illegal move:", moveStr);
                            // If all else fails, just refresh the board and try to proceed.
                            // This might leave the game in an inconsistent state, but prevents a full crash.
                        }
                    }

                    createBoard();
                    updateFenDisplay();
                    gameStatus.textContent = getGameResult();

                    if (game.game_over()) {
                        gameStarted = false;
                        endGameDisplay(); // NEW: Call function to display post-game options
                    } else if (moveApplied) { // Only switch turns if a move was successfully applied
                        switchTurns();
                    } else {
                        // If no move was applied, it means something went wrong.
                        // You might want to implement more robust error handling here,
                        // e.g., reset the game, or notify the user.
                        console.error("Game state potentially inconsistent due to failed bot move application.");
                    }
                }
            };

            stockfish.postMessage('uci');
            stockfish.postMessage('isready');
            stockfish.postMessage('ucinewgame');
        }
    }

    function setPlayerColor(color) {
        humanPlayerColor = color;
        botVsBotMode = false;
        [whiteChoice, blackChoice, randomChoice].forEach(btn => btn.classList.remove('selected'));
        if (color === 'white') whiteChoice.classList.add('selected');
        else if (color === 'black') blackChoice.classList.add('selected');
        else randomChoice.classList.add('selected');
        if (startBotVsBotButton) startBotVsBotButton.classList.remove('selected');
        startButton.disabled = false;
        // Re-render board immediately to show chosen orientation if game has started
        if (gameStarted) {
            createBoard();
        }
    }

    function setDifficulty(level) {
        botDifficulty = level;
        [easyDifficultyBtn, mediumDifficultyBtn, hardDifficultyBtn].forEach(btn => btn.classList.remove('selected'));
        document.getElementById(`difficulty-${level}`).classList.add('selected');
        console.log(`Bot difficulty set to: ${botDifficulty}`);
    }

    function startHumanGame() {
        if (!humanPlayerColor) {
            alert("Please choose to play as White, Black, or Random first!");
            return;
        }
        commonGameSetup();
        if (humanPlayerColor === 'random') {
            humanPlayerColor = Math.random() < 0.5 ? 'white' : 'black';
            // Update selected button for random choice
            [whiteChoice, blackChoice, randomChoice].forEach(btn => btn.classList.remove('selected'));
            if (humanPlayerColor === 'white') whiteChoice.classList.add('selected');
            else blackChoice.classList.add('selected');
        }
        turnDisplay.textContent = `Current Turn: ${currentPlayer.toUpperCase()} (You are ${humanPlayerColor.toUpperCase()})`;
        // Re-render board to reflect final humanPlayerColor choice
        createBoard();

        if (humanPlayerColor === 'black') {
            setTimeout(makeBotMove, 1000);
        }
    }

    function startBotVsBotGame() {
        botVsBotMode = true;
        humanPlayerColor = ''; // No human player
        // Remove 'selected' from player choices, add to bot vs bot button if it exists
        [whiteChoice, blackChoice, randomChoice].forEach(btn => btn.classList.remove('selected'));
        if (startButton) startButton.classList.remove('selected'); // Remove from start game button too
        if (startBotVsBotButton) startBotVsBotButton.classList.add('selected');

        commonGameSetup();
        turnDisplay.textContent = `Current Turn: ${currentPlayer.toUpperCase()} (Bot vs Bot)`;
        // For Bot vs Bot, the board can default to White's POV
        createBoard();
        setTimeout(makeBotMove, 1000);
    }

    function switchTurns() {
        currentPlayer = currentPlayer === 'white' ? 'black' : 'white';
        turnDisplay.textContent = `Current Turn: ${currentPlayer.toUpperCase()} (${botVsBotMode ? 'Bot vs Bot' : `You are ${humanPlayerColor.toUpperCase()}`})`;
        gameStatus.textContent = getGameResult();

        // NEW: Only trigger bot move if we are at the current end of history
        if (gameStarted) {
            if (currentHistoryIndex < gameHistoryStates.length - 1) {
                console.log("Bot move skipped as viewing past history. Jump to last move to resume.");
            } else if (botVsBotMode || currentPlayer !== humanPlayerColor) {
                setTimeout(makeBotMove, botVsBotMode ? 1000 : 500);
            }
        }
    }

    function handlePromotionChoice(chosenPieceType) {
        if (!pendingPromotion) return;

        const { from, to, color } = pendingPromotion;
        promotionGui.style.display = 'none';

        // Perform the promotion move permanently now
        const permanentMoveResult = game.move({ from: from, to: to, promotion: chosenPieceType });

        if (permanentMoveResult) {
            recordMoveAndHistory(permanentMoveResult); // Record the promotion move

            createBoard();
            updateFenDisplay();
            gameStatus.textContent = getGameResult();

            if (game.game_over()) {
                gameStarted = false;
                endGameDisplay(); // Call function to display post-game options
            } else {
                selectedSquareId = null;
                switchTurns();
            }
        } else {
            console.error("Promotion move failed:", { from, to, promotion: chosenPieceType });
            // Fallback: just clear highlights and reset state if promotion fails
            createBoard();
            selectedSquareId = null;
            switchTurns(); // Try to recover by switching turns
        }
        pendingPromotion = null;
    }

    function displayPromotionGUI(from, to, color) {
        pendingPromotion = { from, to, color };
        promotionOptions.innerHTML = '<h2>Promote Pawn to:</h2>';

        // Fix: Use unicode map for displayed pieces, and ensure the value passed to handlePromotionChoice is lowercase
        const promotionPieces = color === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];

        promotionPieces.forEach(pieceChar => {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('promotion-option');
            optionDiv.classList.add(color === 'w' ? 'white-piece' : 'black-piece');
            optionDiv.textContent = pieceUnicodeMap[pieceChar]; // Display unicode character
            // Pass the correct lowercase piece type for chess.js 'promotion' field
            optionDiv.addEventListener('click', () => handlePromotionChoice(pieceChar.toLowerCase())); 
            promotionOptions.appendChild(optionDiv);
        });
        promotionGui.style.display = 'flex';
        promotionGui.style.zIndex = '100'; // Ensure it's on top
    }


    function handleSquareClick(event) {
        // Prevent interaction if not at the latest move in history
        if (currentHistoryIndex < gameHistoryStates.length - 1) {
            alert("You are viewing past game history. Please click on the last move in the 'Move History' panel to resume playing.");
            return;
        }

        if (!gameStarted || botVsBotMode || currentPlayer !== humanPlayerColor || pendingPromotion) {
            return;
        }

        const clickedSquare = event.currentTarget;
        const squareId = clickedSquare.id;

        const clearHighlights = () => {
            document.querySelectorAll('.selected-piece').forEach(sq => sq.classList.remove('selected-piece'));
            document.querySelectorAll('.highlight-move').forEach(sq => sq.classList.remove('highlight-move'));
        };

        if (selectedSquareId === null) {
            const piece = game.get(squareId);
            if (piece && ((piece.color === 'w' && humanPlayerColor === 'white') || (piece.color === 'b' && humanPlayerColor === 'black'))) {
                selectedSquareId = squareId;
                clickedSquare.classList.add('selected-piece');

                const legalMoves = game.moves({ square: squareId, verbose: true });
                legalMoves.forEach(move => {
                    const targetSquare = document.getElementById(move.to);
                    if (targetSquare) targetSquare.classList.add('highlight-move');
                });
            }
        } else {
            const sourceSquare = selectedSquareId;
            const targetSquare = squareId;
            const pieceToMove = game.get(sourceSquare);

            if (!pieceToMove) {
                clearHighlights();
                selectedSquareId = null;
                return;
            }

            // Attempt a "test" move to check for promotion
            const pseudoMove = { from: sourceSquare, to: targetSquare };
            const legalMoves = game.moves({ square: sourceSquare, verbose: true });
            const isPromotionMove = legalMoves.some(m => m.from === sourceSquare && m.to === targetSquare && m.promotion);

            if (isPromotionMove) {
                clearHighlights();
                selectedSquareId = null; // Clear selection
                displayPromotionGUI(sourceSquare, targetSquare, pieceToMove.color);
                return; // Exit, promotion GUI will handle the rest
            }

            // If not a promotion, proceed with regular move logic
            let moveResult = game.move(pseudoMove);

            if (moveResult) {
                recordMoveAndHistory(moveResult); // Record the human's move

                clearHighlights();
                createBoard();
                updateFenDisplay();
                gameStatus.textContent = getGameResult();

                if (game.game_over()) {
                    gameStarted = false;
                    endGameDisplay(); // Call function to display post-game options
                } else {
                    selectedSquareId = null;
                    switchTurns();
                }
            } else {
                // If the move was illegal, check if the click was on another of the player's pieces
                const newPiece = game.get(squareId);
                if (newPiece && ((newPiece.color === 'w' && humanPlayerColor === 'white') || (newPiece.color === 'b' && humanPlayerColor === 'black'))) {
                    clearHighlights();
                    selectedSquareId = squareId;
                    clickedSquare.classList.add('selected-piece');
                    const legalMoves = game.moves({ square: squareId, verbose: true });
                    legalMoves.forEach(move => {
                        const targetSquare = document.getElementById(move.to);
                        if (targetSquare) targetSquare.classList.add('highlight-move');
                    });
                } else {
                    // Clicked on empty square or opponent's piece without a valid move
                    clearHighlights();
                    selectedSquareId = null;
                }
            }
        }
    }

    function makeBotMove() {
        if (stockfish) {
            stockfish.postMessage(`position fen ${game.fen()}`);
            switch (botDifficulty) {
                case 'easy':
                    botDepth = 3;
                    break;
                case 'medium':
                    botDepth = 8;
                    break;
                case 'hard':
                    botDepth = 15;
                    break;
                default:
                    botDepth = 8;
            }
            stockfish.postMessage(`go depth ${botDepth}`);
        } else {
            console.error("Stockfish not initialized!");
            gameStatus.textContent = "Error: Stockfish bot not loaded.";
        }
    }

    // --- NEW: Resign and Post-Game Functions ---

    function handleResign() {
        if (gameStarted && confirm("Are you sure you want to resign?")) {
            const winnerColor = humanPlayerColor === 'white' ? 'Black' : 'White';
            gameStatus.textContent = `${humanPlayerColor.toUpperCase()} Resigns! ${winnerColor} wins!`;
            gameStarted = false;
            endGameDisplay();
        }
    }

    function endGameDisplay() {
        gameActions.style.display = 'none'; // Hide resign button
        postGameOptions.style.display = 'flex'; // Show rematch/menu buttons
    }

    function handleRematch() {
        // Restart the game based on the current mode/player choice
        if (botVsBotMode) {
            startBotVsBotGame();
        } else {
            // For human game, we'll effectively re-initiate based on selected humanPlayerColor
            startHumanGame();
        }
    }

    function returnToMainMenu() {
        // Completely reset the game state and UI to initial menu state
        gameStarted = false;
        humanPlayerColor = '';
        botVsBotMode = false;
        selectedSquareId = null;
        game.reset(); // Reset chess.js board
        gameHistoryStates = [];
        currentHistoryIndex = -1;

        // Hide game-related elements
        chessboard.style.display = 'none';
        turnDisplay.style.display = 'none';
        fenDisplay.style.display = 'none';
        moveHistoryPanel.style.display = 'none';
        gameActions.style.display = 'none';
        postGameOptions.style.display = 'none';
        promotionGui.style.display = 'none';

        // Show initial game controls
        gameControls.style.display = 'block';
        gameStatus.textContent = "Choose your side and bot difficulty, or start Bot vs Bot!";
        gameStatus.style.display = 'block';

        // Reset selected difficulty/player choice buttons
        [whiteChoice, blackChoice, randomChoice, startBotVsBotButton].forEach(btn => btn.classList.remove('selected'));
        [easyDifficultyBtn, mediumDifficultyBtn, hardDifficultyBtn].forEach(btn => btn.classList.remove('selected'));
        mediumDifficultyBtn.classList.add('selected'); // Re-select default difficulty
        startButton.disabled = true; // Disable start until a player side is chosen
    }


    // --- Initial Setup and Event Listeners ---
    chessboard.style.display = 'none';
    turnDisplay.style.display = 'none';
    fenDisplay.style.display = 'none';
    gameStatus.style.display = 'none';
    promotionGui.style.display = 'none';
    moveHistoryPanel.style.display = 'none';
    gameActions.style.display = 'none'; // NEW: Hide resign button initially
    postGameOptions.style.display = 'none'; // NEW: Hide post-game options initially

    whiteChoice.addEventListener('click', () => setPlayerColor('white'));
    blackChoice.addEventListener('click', () => setPlayerColor('black'));
    randomChoice.addEventListener('click', () => setPlayerColor('random'));
    startButton.addEventListener('click', startHumanGame);
    if (startBotVsBotButton) {
        startBotVsBotButton.addEventListener('click', startBotVsBotGame);
    }

    easyDifficultyBtn.addEventListener('click', () => setDifficulty('easy'));
    mediumDifficultyBtn.addEventListener('click', () => setDifficulty('medium'));
    hardDifficultyBtn.addEventListener('click', () => setDifficulty('hard'));

    // NEW: Add event listeners for the new buttons
    resignButton.addEventListener('click', handleResign);
    rematchButton.addEventListener('click', handleRematch);
    returnToMenuButton.addEventListener('click', returnToMainMenu);

    gameStatus.textContent = "Choose your side and bot difficulty, or start Bot vs Bot!";
    gameStatus.style.display = 'block';

    // Set initial difficulty selection
    mediumDifficultyBtn.classList.add('selected');
});
