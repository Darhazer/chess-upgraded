// Forked from js-chess-engine v1.0.3 by Josef Jadrny (MIT — see ./LICENSE).
//
// Modifications for the chess variants this app hosts, all tagged with a
// `// VARIANT:` comment below. `configuration.variant` selects the rule set
// ('upgraded' | 'cannibal').
//
// "upgrade" variant (see shared/upgrade-rules.js; server/src/rules-engine.js is
// its authoritative referee — for that variant this fork is only the bot brain):
//   - `configuration` carries `upgraded` ({ SQUARE: true }).
//   - `getPieceMoves` adds the move-only bonus moves an upgraded piece gains.
//   - `move` transfers the upgrade flag and auto-upgrades the capturing piece.
//   - `calculateScore` adds an upgraded-piece bonus.
//
// Extension points other variants subclass Board to override (kept generic
// here so this file carries no variant-specific rules beyond "upgrade"):
//   - `movementType(piece)` — the type a piece moves/attacks as.
//   - `getKingMoves` — the king's moveset.
//   - `playingKingCanCastle()` — whether the side to move may castle at all.
//   - `onMoveApplied(...)` — a post-move hook for variant side effects.
//   - clones go through `new this.constructor(...)`, so subclasses stay typed.
//
// `getTestBoard`/`getMoves` copy variant state so it survives the per-node
// board clones the search makes.

import {
    AI_LEVELS,
    AI_DEPTH_BY_LEVEL,
    COLORS,
    NEW_GAME_BOARD_CONFIG,
    NEW_GAME_SETTINGS,
    down,
    downByColor,
    downLeft,
    downLeftByColor,
    downLeftDown,
    downLeftLeft,
    downRight,
    downRightByColor,
    downRightDown,
    downRightRight,
    left,
    right,
    scoreByPosition,
    up,
    upByColor,
    upLeft,
    upLeftByColor,
    upLeftLeft,
    upLeftUp,
    upRight,
    upRightByColor,
    upRightRight,
    upRightUp,
} from './const.js'

import { getPieceValue, getJSONfromFEN, isPieceValid, isLocationValid } from './utils.js'

// VARIANT: bridge to the shared upgrade-rules patterns + variant tunables.
import {
    customBonusTargets,
    TELEPORT_PREFIX,
    UPGRADE_BONUS,
} from '../variant.js'

const SCORE = {
    MIN: -1000,
    MAX: 1000,
}

const PIECE_VALUE_MULTIPLIER = 10

// VARIANT: Chebyshev distance between two squares ('E1', 'C3' -> 2).
function squareDistance (a, b) {
    const df = Math.abs(a.charCodeAt(0) - b.charCodeAt(0))
    const dr = Math.abs(Number(a[1]) - Number(b[1]))
    return Math.max(df, dr)
}

export default class Board {
    constructor (configuration = JSON.parse(JSON.stringify(NEW_GAME_BOARD_CONFIG))) {
        if (typeof configuration === 'object') {
            this.configuration = Object.assign({}, NEW_GAME_SETTINGS, configuration)
        } else if (typeof configuration === 'string') {
            this.configuration = Object.assign({}, NEW_GAME_SETTINGS, getJSONfromFEN(configuration))
        } else {
            throw new Error(`Unknown configuration type ${typeof config}.`)
        }
        if (!this.configuration.castling) {
            this.configuration.castling = {
                whiteShort: true,
                blackShort: true,
                whiteLong: true,
                blackLong: true,
            }
        }
        // VARIANT: default the upgrade state if the caller didn't provide it.
        if (!this.configuration.upgraded) this.configuration.upgraded = {}
        // VARIANT: which variant's rules apply. 'upgraded' is this fork's
        // historical default and the only one whose rules live in this file;
        // other variants subclass Board (see server/src/engine/cannibal-board.js)
        // and override the extension points below.
        if (!this.configuration.variant) this.configuration.variant = 'upgraded'
        this.history = []
    }

    getAttackingFields (color = this.getPlayingColor()) {
        let attackingFields = []
        for (const location in this.configuration.pieces) {
            const piece = this.getPiece(location)
            if (this.getPieceColor(piece) === color) {
                // VARIANT: attacksOnly — a non-pawn's bonus moves are move-only
                // (they threaten nothing) and an upgraded pawn attacks only the
                // square straight ahead.
                attackingFields = [...attackingFields, ...this.getPieceMoves(piece, location, true)]
            }
        }
        return attackingFields
    }

    isAttackingKing (color = this.getPlayingColor()) {
        let kingLocation = null
        for (const location in this.configuration.pieces) {
            const piece = this.getPiece(location)
            if (this.isKing(piece) && this.getPieceColor(piece) !== color) {
                kingLocation = location
                break
            }
        }

        return this.isPieceUnderAttack(kingLocation)
    }

    // VARIANT: would a *standard* pawn of `byColor` attack `square`? (Used to
    // mirror a chess.js-inherited restriction in RulesEngine — see getMoves.)
    isStandardPawnAttacked (square, byColor) {
        for (const src of [downLeftByColor(square, byColor), downRightByColor(square, byColor)]) {
            if (!src) continue
            const p = this.getPiece(src)
            if (p && this.getPieceColor(p) === byColor && this.isPawn(p)) return true
        }
        return false
    }

    isPieceUnderAttack (pieceLocation) {
        const playerColor = this.getPieceOnLocationColor(pieceLocation)
        const enemyColor = this.getEnemyColor(playerColor)
        let isUnderAttack = false

        let field = pieceLocation
        let distance = 0
        while (up(field) && !isUnderAttack) {
            field = up(field)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksOrthogonal(piece) || (this.attacksAsKing(piece) && distance === 1))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = pieceLocation
        distance = 0
        while (down(field) && !isUnderAttack) {
            field = down(field)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksOrthogonal(piece) || (this.attacksAsKing(piece) && distance === 1))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = pieceLocation
        distance = 0
        while (left(field) && !isUnderAttack) {
            field = left(field)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksOrthogonal(piece) || (this.attacksAsKing(piece) && distance === 1))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = pieceLocation
        distance = 0
        while (right(field) && !isUnderAttack) {
            field = right(field)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksOrthogonal(piece) || (this.attacksAsKing(piece) && distance === 1))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = pieceLocation
        distance = 0
        while (upRightByColor(field, playerColor) && !isUnderAttack) {
            field = upRightByColor(field, playerColor)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksDiagonal(piece) ||
                 (distance === 1 && (this.attacksAsKing(piece) || this.attacksAsPawn(piece))))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = pieceLocation
        distance = 0
        while (upLeftByColor(field, playerColor) && !isUnderAttack) {
            field = upLeftByColor(field, playerColor)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksDiagonal(piece) ||
                 (distance === 1 && (this.attacksAsKing(piece) || this.attacksAsPawn(piece))))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = pieceLocation
        distance = 0
        while (downRightByColor(field, playerColor) && !isUnderAttack) {
            field = downRightByColor(field, playerColor)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksDiagonal(piece) || (this.attacksAsKing(piece) && distance === 1))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = pieceLocation
        distance = 0
        while (downLeftByColor(field, playerColor) && !isUnderAttack) {
            field = downLeftByColor(field, playerColor)
            distance++
            const piece = this.getPiece(field)
            if (piece && this.getPieceColor(piece) === enemyColor &&
                (this.attacksDiagonal(piece) || (this.attacksAsKing(piece) && distance === 1))) {
                isUnderAttack = true
            }
            if (piece) break
        }

        field = upRightUp(pieceLocation)
        let piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }
        field = upRightRight(pieceLocation)
        piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }
        field = upLeftLeft(pieceLocation)
        piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }
        field = upLeftUp(pieceLocation)
        piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }
        field = downLeftDown(pieceLocation)
        piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }
        field = downLeftLeft(pieceLocation)
        piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }
        field = downRightDown(pieceLocation)
        piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }
        field = downRightRight(pieceLocation)
        piece = this.getPiece(field)
        if (piece && this.getPieceColor(piece) === enemyColor && this.attacksAsKnight(piece)) {
            isUnderAttack = true
        }

        return isUnderAttack
    }

    hasPlayingPlayerCheck () {
        return this.isAttackingKing(this.getNonPlayingColor())
    }

    hasNonPlayingPlayerCheck () {
        return this.isAttackingKing(this.getPlayingColor())
    }

    getLowestValuePieceAttackingLocation (location, color = this.getPlayingColor()) {
        let pieceValue = null
        for (const field in this.configuration.pieces) {
            const piece = this.getPiece(field)
            if (this.getPieceColor(piece) === color) {
                this.getPieceMoves(piece, field, true).map(attackingLocation => {
                    if (attackingLocation === location && (pieceValue === null || getPieceValue(piece) < pieceValue)) {
                        pieceValue = getPieceValue(piece)
                    }
                })
            }
        }
        return pieceValue
    }

    getMoves (color = this.getPlayingColor(), movablePiecesRequiredToSkipTest = null) {
        const allMoves = {}
        let movablePiecesCount = 0
        for (const location in this.configuration.pieces) {
            const piece = this.getPiece(location)
            if (this.getPieceColor(piece) === color) {
                const moves = this.getPieceMoves(piece, location)
                if (moves.length) {
                    movablePiecesCount++
                }
                Object.assign(allMoves, { [location]: moves })
            }
        }

        const enemyAttackingFields = this.getAttackingFields(this.getNonPlayingColor())
        if (this.isLeftCastlingPossible(enemyAttackingFields)) {
            if (this.isPlayingWhite()) allMoves.E1.push('C1')
            if (this.isPlayingBlack()) allMoves.E8.push('C8')
        }
        if (this.isRightCastlingPossible(enemyAttackingFields)) {
            if (this.isPlayingWhite()) allMoves.E1.push('G1')
            if (this.isPlayingBlack()) allMoves.E8.push('G8')
        }

        if (movablePiecesRequiredToSkipTest && movablePiecesCount > movablePiecesRequiredToSkipTest) {
            return allMoves
        }

        const moves = {}
        for (const from in allMoves) {
            allMoves[from].map(to => {
                const testConfiguration = {
                    pieces: Object.assign({}, this.configuration.pieces),
                    castling: Object.assign({}, this.configuration.castling),
                    // VARIANT: carry turn/enPassant/upgrade-state into the
                    // legality probe (upstream omitted turn/enPassant, which
                    // mishandled black promotions & en-passant in the probe).
                    turn: this.configuration.turn,
                    enPassant: this.configuration.enPassant,
                    upgraded: Object.assign({}, this.configuration.upgraded),
                    // VARIANT: carry the variant tag + any subclass king state.
                    variant: this.configuration.variant,
                    kingType: this.configuration.kingType
                        ? Object.assign({}, this.configuration.kingType)
                        : undefined,
                }
                // VARIANT: `this.constructor` keeps the probe board the same
                // (sub)class, so a subclass's rule overrides apply mid-search.
                const testBoard = new this.constructor(testConfiguration)
                testBoard.move(from, to)
                const kingSafe =
                    (this.isPlayingWhite() && !testBoard.isAttackingKing(COLORS.BLACK)) ||
                    (this.isPlayingBlack() && !testBoard.isAttackingKing(COLORS.WHITE))
                if (!kingSafe) return
                // VARIANT: RulesEngine generates *standard* king moves via
                // chess.js, which (not knowing about upgrades) still treats
                // every enemy pawn as attacking its diagonals — so the referee
                // won't let a king take a normal step onto a square a standard
                // pawn would attack, even an upgraded one. Mirror that for
                // ordinary king moves so our move set equals the referee's. A
                // king *teleport* is a custom move there, filtered by the
                // variant-aware check instead (already handled by kingSafe).
                const moverPiece = this.getPiece(from)
                if (moverPiece && this.isKing(moverPiece) && this.configuration.variant === 'upgraded') {
                    const isBonusKingMove = to[0] === TELEPORT_PREFIX || squareDistance(from, to) >= 2
                    if (!isBonusKingMove && this.isStandardPawnAttacked(to, this.getNonPlayingColor())) return
                }
                if (!moves[from]) {
                    moves[from] = []
                }
                moves[from].push(to)
            })
        }

        if (!Object.keys(moves).length) {
            this.configuration.isFinished = true
            if (this.hasPlayingPlayerCheck()) {
                this.configuration.checkMate = true
            }
            return moves
        }

        return moves
    }

    // VARIANT extension point: whether the side to move may castle at all.
    // Subclasses override this (e.g. a cannibalised king can no longer castle).
    playingKingCanCastle () {
        return true
    }

    // VARIANT extension point: invoked by `move()` once the piece has been
    // relocated (and any auto-queen / en-passant capture resolved), before the
    // turn flips. No-op here; subclasses use it for variant side effects such
    // as the cannibal capture-transform. `mover` is the pre-move piece char.
    onMoveApplied (/* { from, to, mover, captured, enPassantCapture, promoted, movingColor } */) {}

    isLeftCastlingPossible (enemyAttackingFields) {
        if (!this.playingKingCanCastle()) return false
        if (this.isPlayingWhite() && !this.configuration.castling.whiteLong) return false
        if (this.isPlayingBlack() && !this.configuration.castling.blackLong) return false

        let kingLocation = null
        if (this.isPlayingWhite() && this.getPiece('E1') === 'K' && this.getPiece('A1') === 'R' && !enemyAttackingFields.includes('E1')) {
            kingLocation = 'E1'
        } else if (this.isPlayingBlack() && this.getPiece('E8') === 'k' && this.getPiece('A8') === 'r' && !enemyAttackingFields.includes('E8')) {
            kingLocation = 'E8'
        }
        if (!kingLocation) return false
        let field = left(kingLocation)
        if (this.getPiece(field) || enemyAttackingFields.includes(field)) return false
        field = left(field)
        if (this.getPiece(field) || enemyAttackingFields.includes(field)) return false
        field = left(field)
        if (this.getPiece(field)) return false

        return true
    }

    isRightCastlingPossible (enemyAttackingFields) {
        if (!this.playingKingCanCastle()) return false
        if (this.isPlayingWhite() && !this.configuration.castling.whiteShort) return false
        if (this.isPlayingBlack() && !this.configuration.castling.blackShort) return false

        let kingLocation = null
        if (this.isPlayingWhite() && this.getPiece('E1') === 'K' && this.getPiece('H1') === 'R' && !enemyAttackingFields.includes('E1')) {
            kingLocation = 'E1'
        } else if (this.isPlayingBlack() && this.getPiece('E8') === 'k' && this.getPiece('H8') === 'r' && !enemyAttackingFields.includes('E8')) {
            kingLocation = 'E8'
        }
        if (!kingLocation) return false

        let field = right(kingLocation)
        if (this.getPiece(field) || enemyAttackingFields.includes(field)) return false
        field = right(field)
        if (this.getPiece(field) || enemyAttackingFields.includes(field)) return false

        return true
    }

    getPieceMoves (piece, location, attacksOnly = false) {
        const isUpgraded = !!this.configuration.upgraded[location]

        let moves
        if (this.isPawn(piece)) moves = this.getPawnMoves(piece, location)
        else if (this.isKnight(piece)) moves = this.getKnightMoves(piece, location)
        else if (this.isRook(piece)) moves = this.getRookMoves(piece, location)
        else if (this.isBishop(piece)) moves = this.getBishopMoves(piece, location)
        else if (this.isQueen(piece)) moves = this.getQueenMoves(piece, location)
        else if (this.isKing(piece)) moves = this.getKingMoves(piece, location)
        else return []

        // VARIANT: an upgraded piece keeps its normal moves and gains its
        // bonus moves. Bonus moves are move-only, so they don't show up as
        // attacks.
        if (isUpgraded && !attacksOnly) {
            for (const target of customBonusTargets(this, piece, location)) {
                if (!moves.includes(target)) moves.push(target)
            }
        }
        return moves
    }

    isPawn (piece) {
        return piece.toUpperCase() === 'P'
    }

    isKnight (piece) {
        return piece.toUpperCase() === 'N'
    }

    isRook (piece) {
        return piece.toUpperCase() === 'R'
    }

    isBishop (piece) {
        return piece.toUpperCase() === 'B'
    }

    isQueen (piece) {
        return piece.toUpperCase() === 'Q'
    }

    isKing (piece) {
        return piece.toUpperCase() === 'K'
    }

    getPawnMoves (piece, location) {
        const moves = []
        const color = this.getPieceColor(piece)
        let move = upByColor(location, color)

        if (move && !this.getPiece(move)) {
            moves.push(move)
            move = upByColor(move, color)
            if (isInStartLine(color, location) && move && !this.getPiece(move)) {
                moves.push(move)
            }
        }

        move = upLeftByColor(location, color)
        if (move && ((this.getPiece(move) && this.getPieceOnLocationColor(move) !== color) || (move === this.configuration.enPassant))) {
            moves.push(move)
        }

        move = upRightByColor(location, color)
        if (move && ((this.getPiece(move) && this.getPieceOnLocationColor(move) !== color) || (move === this.configuration.enPassant))) {
            moves.push(move)
        }

        function isInStartLine (color, location) {
            if (color === COLORS.WHITE && location[1] === '2') {
                return true
            }
            if (color === COLORS.BLACK && location[1] === '7') {
                return true
            }
            return false
        }

        return moves
    }

    getKnightMoves (piece, location) {
        const moves = []
        const color = this.getPieceColor(piece)

        let field = upRightUp(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = upRightRight(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = upLeftUp(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = upLeftLeft(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = downLeftLeft(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = downLeftDown(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = downRightRight(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = downRightDown(location)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        return moves
    }

    getRookMoves (piece, location) {
        const moves = []
        const color = this.getPieceColor(piece)

        let field = location
        while (up(field)) {
            field = up(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        field = location
        while (down(field)) {
            field = down(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        field = location
        while (right(field)) {
            field = right(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        field = location
        while (left(field)) {
            field = left(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        return moves
    }

    getBishopMoves (piece, location) {
        const moves = []
        const color = this.getPieceColor(piece)

        let field = location
        while (upLeft(field)) {
            field = upLeft(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        field = location
        while (upRight(field)) {
            field = upRight(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        field = location
        while (downLeft(field)) {
            field = downLeft(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        field = location
        while (downRight(field)) {
            field = downRight(field)
            const pieceOnFieldColor = this.getPieceOnLocationColor(field)
            if (this.getPieceOnLocationColor(field) !== color) {
                moves.push(field)
            }
            if (pieceOnFieldColor) break
        }

        return moves
    }

    getQueenMoves (piece, location) {
        const moves = [
            ...this.getRookMoves(piece, location),
            ...this.getBishopMoves(piece, location),
        ]
        return moves
    }

    getKingMoves (piece, location) {
        const moves = []
        const color = this.getPieceColor(piece)

        let field = location
        field = up(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = location
        field = right(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = location
        field = down(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = location
        field = left(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = location
        field = upLeft(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = location
        field = upRight(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = location
        field = downLeft(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        field = location
        field = downRight(field)
        if (field && this.getPieceOnLocationColor(field) !== color) {
            moves.push(field)
        }

        return moves
    }

    getPieceColor (piece) {
        if (piece.toUpperCase() === piece) return COLORS.WHITE
        return COLORS.BLACK
    }

    // VARIANT extension point: the piece-type a piece *moves and attacks as*.
    // Here it is simply the piece's own type; subclasses override it (e.g. a
    // cannibal king keeps its 'k' board char but moves as what it cannibalised).
    movementType (piece) {
        return piece.toLowerCase()
    }

    // VARIANT: attack predicates keyed on `movementType`, so a subclass that
    // overrides `movementType` (e.g. a cannibal king) changes what a piece
    // attacks as. With the default `movementType` these reduce to the piece's
    // own type and behave exactly as the inline checks did.
    attacksOrthogonal (piece) {
        const mt = this.movementType(piece)
        return mt === 'r' || mt === 'q'
    }

    attacksDiagonal (piece) {
        const mt = this.movementType(piece)
        return mt === 'b' || mt === 'q'
    }

    attacksAsKing (piece) {
        return this.movementType(piece) === 'k'
    }

    attacksAsPawn (piece) {
        return this.movementType(piece) === 'p'
    }

    attacksAsKnight (piece) {
        return this.movementType(piece) === 'n'
    }

    getPieceOnLocationColor (location) {
        const piece = this.getPiece(location)
        if (!piece) return null
        if (piece.toUpperCase() === piece) return COLORS.WHITE
        return COLORS.BLACK
    }

    getPiece (location) {
        return this.configuration.pieces[location]
    }

    setPiece (location, piece) {
        if (!isPieceValid(piece)) {
            throw new Error(`Invalid piece ${piece}`)
        }

        if (!isLocationValid(location)) {
            throw new Error(`Invalid location ${location}`)
        }

        this.configuration.pieces[location.toUpperCase()] = piece
    }

    removePiece (location) {
        if (!isLocationValid(location)) {
            throw new Error(`Invalid location ${location}`)
        }

        delete this.configuration.pieces[location.toUpperCase()]
    }

    isEmpty (location) {
        if (!isLocationValid(location)) {
            throw new Error(`Invalid location ${location}`)
        }

        return !this.configuration.pieces[location.toUpperCase()]
    }

    getEnemyColor (playerColor) {
        return playerColor === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE
    }

    getPlayingColor () {
        return this.configuration.turn
    }

    getNonPlayingColor () {
        return this.isPlayingWhite() ? COLORS.BLACK : COLORS.WHITE
    }

    isPlayingWhite () {
        return this.configuration.turn === COLORS.WHITE
    }

    isPlayingBlack () {
        return this.configuration.turn === COLORS.BLACK
    }

    addMoveToHistory (from, to) {
        const historyConfiguration = JSON.parse(JSON.stringify(this.configuration))
        // Add computed check property that should be in the history
        historyConfiguration.check = this.hasPlayingPlayerCheck()
        this.history.push({ from, to, configuration: historyConfiguration })
    }

    move (from, to) {
        // VARIANT: a king's teleport to one of its castling squares is tagged
        // (`~C1`/`~G1`/...) so it isn't mistaken for a castle. Strip the tag and
        // remember not to drag a rook along.
        let isKingTeleport = false
        if (to[0] === TELEPORT_PREFIX) {
            to = to.slice(TELEPORT_PREFIX.length)
            isKingTeleport = true
        }

        // Move logic
        const chessmanFrom = this.getPiece(from)
        const chessmanTo = this.getPiece(to)

        if (!chessmanFrom) {
            throw new Error(`There is no piece at ${from}`)
        }

        // VARIANT: capture these before any mutation.
        const movingColor = this.getPlayingColor()
        const wasUpgraded = !!this.configuration.upgraded[from]
        const isPawnMove = this.isPawn(chessmanFrom)
        // An E1->C1/G1 king step is a castle only while the king may still
        // castle; a subclass (e.g. a cannibalised king) can refuse, leaving it
        // an ordinary slide instead.
        const castlingMoveAllowed = this.playingKingCanCastle()

        Object.assign(this.configuration.pieces, { [to]: chessmanFrom })
        delete this.configuration.pieces[from]

        // pawn reaches an end of a chessboard -> auto-queen
        let promoted = false
        if (isPawnMove && (to[1] === '8' || to[1] === '1')) {
            Object.assign(this.configuration.pieces, { [to]: movingColor === COLORS.WHITE ? 'Q' : 'q' })
            promoted = true
        }

        // En passant capture.
        let enPassantCapture = false
        if (isPawnMove && to === this.configuration.enPassant) {
            const captured = downByColor(to, movingColor)
            delete this.configuration.pieces[captured]
            delete this.configuration.upgraded[captured] // VARIANT
            enPassantCapture = true
        }

        // VARIANT (upgrade): upgrade-flag bookkeeping. A captured piece (incl.
        // en passant, above) loses its flag; the mover carries its flag to the
        // destination — unless it just promoted with no capture (the piece
        // is a queen now). On any capture, the mover is auto-upgraded —
        // except a K/Q capturing an unupgraded pawn (value-floor rule).
        if (this.configuration.variant === 'upgraded') {
            const capturedWasUpgraded = chessmanTo && !!this.configuration.upgraded[to]
            if (chessmanTo) delete this.configuration.upgraded[to]
            if (wasUpgraded) {
                delete this.configuration.upgraded[from]
            }
            const captureHappened = !!chessmanTo || enPassantCapture
            const moverIsKingOrQueen =
                chessmanFrom === 'K' || chessmanFrom === 'k' ||
                chessmanFrom === 'Q' || chessmanFrom === 'q'
            const cheapCapture =
                captureHappened &&
                moverIsKingOrQueen &&
                (chessmanTo === 'P' || chessmanTo === 'p') &&
                !capturedWasUpgraded
            if ((captureHappened && !cheapCapture) || (wasUpgraded && !promoted)) {
                this.configuration.upgraded[to] = true
            }
        }

        // VARIANT extension point: variant-specific side effects of the move
        // (e.g. cannibal capture-transform). No-op in the base engine.
        this.onMoveApplied({
            from,
            to,
            mover: chessmanFrom,
            captured: chessmanTo || null,
            enPassantCapture,
            promoted,
            movingColor,
        })

        // pawn double-push -> en passant target
        if (isPawnMove && !promoted &&
            ((movingColor === COLORS.WHITE && from[1] === '2' && to[1] === '4') ||
             (movingColor === COLORS.BLACK && from[1] === '7' && to[1] === '5'))) {
            this.configuration.enPassant = `${from[0]}${movingColor === COLORS.WHITE ? '3' : '6'}`
        } else {
            this.configuration.enPassant = null
        }

        // Castling - disabling
        if (from === 'E1') {
            Object.assign(this.configuration.castling, { whiteLong: false, whiteShort: false })
        }
        if (from === 'E8') {
            Object.assign(this.configuration.castling, { blackLong: false, blackShort: false })
        }
        if (from === 'A1') {
            Object.assign(this.configuration.castling, { whiteLong: false })
        }
        if (from === 'H1') {
            Object.assign(this.configuration.castling, { whiteShort: false })
        }
        if (from === 'A8') {
            Object.assign(this.configuration.castling, { blackLong: false })
        }
        if (from === 'H8') {
            Object.assign(this.configuration.castling, { blackShort: false })
        }
        // Castling - disabling when a corner rook is captured / replaced. The
        // upstream engine relied on the `getPiece(corner) === 'R'` check in
        // isLeft/RightCastlingPossible; clearing the right outright also keeps
        // the cannibal "original rooks only" rule honest (a piece that *became*
        // a rook on a corner must not inherit a castling right).
        if (to === 'A1') Object.assign(this.configuration.castling, { whiteLong: false })
        if (to === 'H1') Object.assign(this.configuration.castling, { whiteShort: false })
        if (to === 'A8') Object.assign(this.configuration.castling, { blackLong: false })
        if (to === 'H8') Object.assign(this.configuration.castling, { blackShort: false })

        // Castling - rook is moving too. The recursive rook move performs
        // the turn flip once.
        // VARIANT: ...unless this was a king *teleport* onto a castle square,
        // or a subclass king that may no longer castle (then E1->C1/G1 is a
        // plain slide).
        if (this.isKing(chessmanFrom) && !isKingTeleport && castlingMoveAllowed) {
            if (from === 'E1' && to === 'C1') return this.move('A1', 'D1')
            if (from === 'E8' && to === 'C8') return this.move('A8', 'D8')
            if (from === 'E1' && to === 'G1') return this.move('H1', 'F1')
            if (from === 'E8' && to === 'G8') return this.move('H8', 'F8')
        }

        this.configuration.turn = this.isPlayingWhite() ? COLORS.BLACK : COLORS.WHITE

        if (this.isPlayingWhite()) {
            this.configuration.fullMove++
        }

        this.configuration.halfMove++
        if (chessmanTo || isPawnMove) {
            this.configuration.halfMove = 0
        }
    }

    exportJson () {
        return {
            moves: this.getMoves(),
            pieces: this.configuration.pieces,
            turn: this.configuration.turn,
            isFinished: this.configuration.isFinished,
            check: this.hasPlayingPlayerCheck(),
            checkMate: this.configuration.checkMate,
            castling: this.configuration.castling,
            enPassant: this.configuration.enPassant,
            halfMove: this.configuration.halfMove,
            fullMove: this.configuration.fullMove,
            // VARIANT
            upgraded: this.configuration.upgraded,
        }
    }

    calculateAiMove (level) {
        const scores = this.calculateAiMoves(level)
        return scores[0]
    }

    calculateAiMoves (level) {
        level = parseInt(level)
        if (!AI_LEVELS.includes(level)) {
            throw new Error(`Invalid level ${level}. You can choose ${AI_LEVELS.join(',')}`)
        }
        if (this.shouldIncreaseLevel()) {
            level++
        }
        const scoreTable = []
        const initialScore = this.calculateScore(this.getPlayingColor())
        const moves = this.getMoves()
        for (const from in moves) {
            moves[from].map(to => {
                const testBoard = this.getTestBoard()
                const wasScoreChanged = Boolean(testBoard.getPiece(to))
                testBoard.move(from, to)
                scoreTable.push({
                    from,
                    to,
                    score: testBoard.testMoveScores(this.getPlayingColor(), level, wasScoreChanged, wasScoreChanged ? testBoard.calculateScore(this.getPlayingColor()) : initialScore, to).score +
                        testBoard.calculateScoreByPiecesLocation(this.getPlayingColor()) +
                        (Math.floor(Math.random() * (this.configuration.halfMove > 10 ? this.configuration.halfMove - 10 : 1) * 10) / 10),
                })
            })
        }

        scoreTable.sort((previous, next) => {
            return previous.score < next.score ? 1 : previous.score > next.score ? -1 : 0
        })
        return scoreTable
    }

    shouldIncreaseLevel () {
        return this.getIngamePiecesValue() < 50
    }

    getIngamePiecesValue () {
        let scoreIndex = 0
        for (const location in this.configuration.pieces) {
            const piece = this.getPiece(location)
            scoreIndex += getPieceValue(piece)
        }
        return scoreIndex
    }

    getTestBoard () {
        const testConfiguration = {
            pieces: Object.assign({}, this.configuration.pieces),
            castling: Object.assign({}, this.configuration.castling),
            turn: this.configuration.turn,
            enPassant: this.configuration.enPassant,
            // VARIANT: the search clones the board per node — carry the variant
            // state along or it would be silently lost mid-search.
            upgraded: Object.assign({}, this.configuration.upgraded),
            variant: this.configuration.variant,
            kingType: this.configuration.kingType
                ? Object.assign({}, this.configuration.kingType)
                : undefined,
        }
        return new this.constructor(testConfiguration)
    }

    testMoveScores (playingPlayerColor, level, capture, initialScore, move, depth = 1) {
        let nextMoves = null
        if (depth < AI_DEPTH_BY_LEVEL.EXTENDED[level] && this.hasPlayingPlayerCheck()) {
            nextMoves = this.getMoves(this.getPlayingColor())
        } else if (depth < AI_DEPTH_BY_LEVEL.BASE[level] || (capture && depth < AI_DEPTH_BY_LEVEL.EXTENDED[level])) {
            nextMoves = this.getMoves(this.getPlayingColor(), 5)
        }

        if (this.configuration.isFinished) {
            return {
                score: this.calculateScore(playingPlayerColor) + (this.getPlayingColor() === playingPlayerColor ? depth : -depth),
                max: true,
            }
        }

        if (!nextMoves) {
            if (initialScore !== null) return { score: initialScore, max: false }
            const score = this.calculateScore(playingPlayerColor)
            return {
                score,
                max: false,
            }
        }

        let bestScore = this.getPlayingColor() === playingPlayerColor ? SCORE.MIN : SCORE.MAX
        let maxValueReached = false
        for (const from in nextMoves) {
            if (maxValueReached) continue
            nextMoves[from].map(to => {
                if (maxValueReached) return
                const testBoard = this.getTestBoard()
                const wasScoreChanged = Boolean(testBoard.getPiece(to))
                testBoard.move(from, to)
                if (testBoard.hasNonPlayingPlayerCheck()) return
                const result = testBoard.testMoveScores(playingPlayerColor, level, wasScoreChanged, wasScoreChanged ? testBoard.calculateScore(playingPlayerColor) : initialScore, to, depth + 1)
                if (result.max) {
                    maxValueReached = true
                }
                if (this.getPlayingColor() === playingPlayerColor) {
                    bestScore = Math.max(bestScore, result.score)
                } else {
                    bestScore = Math.min(bestScore, result.score)
                }
            })
        }

        return { score: bestScore, max: false }
    }

    calculateScoreByPiecesLocation (player = this.getPlayingColor()) {
        const columnMapping = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7 }
        const scoreMultiplier = 0.5
        let score = 0
        for (const location in this.configuration.pieces) {
            const piece = this.getPiece(location)
            if (scoreByPosition[piece]) {
                const scoreIndex = scoreByPosition[piece][location[1] - 1][columnMapping[location[0]]]
                score += (this.getPieceColor(piece) === player ? scoreIndex : -scoreIndex) * scoreMultiplier
            }
        }
        return score
    }

    calculateScore (playerColor = this.getPlayingColor()) {
        let scoreIndex = 0

        if (this.configuration.checkMate) {
            if (this.getPlayingColor() === playerColor) {
                return SCORE.MIN
            } else {
                return SCORE.MAX
            }
        }

        if (this.configuration.isFinished) {
            if (this.getPlayingColor() === playerColor) {
                return SCORE.MAX
            } else {
                return SCORE.MIN
            }
        }

        for (const location in this.configuration.pieces) {
            const piece = this.getPiece(location)
            const sign = this.getPieceColor(piece) === playerColor ? 1 : -1
            scoreIndex += sign * getPieceValue(piece) * PIECE_VALUE_MULTIPLIER
            // VARIANT: an upgraded piece is worth a bit more.
            if (this.configuration.upgraded[location]) {
                scoreIndex += sign * (UPGRADE_BONUS[piece.toLowerCase()] || 0)
            }
        }

        return scoreIndex
    }
}
