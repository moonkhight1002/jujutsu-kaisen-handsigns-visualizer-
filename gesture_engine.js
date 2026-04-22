/**
 * GestureEngine.js
 * High-precision hand gesture detection for JJK Visualizer.
 * Uses normalized landmark coordinates and temporal filtering.
 */

export class GestureEngine {
    constructor(bufferSize = 8) {
        this.bufferSize = bufferSize;
        this.gestureBuffer = [];
        this.lastGesture = 'neutral';
        this.confidenceThreshold = 0.6; // Require 60% agreement in buffer
    }

    /**
     * Detects the current gesture from MediaPipe landmarks
     * @param {Array} multiHandLandmarks 
     * @returns {string} The detected gesture
     */
    detect(multiHandLandmarks) {
        if (!multiHandLandmarks || multiHandLandmarks.length === 0) {
            return this.updateBuffer('neutral');
        }

        const hands = multiHandLandmarks;

        // Two-hand gestures take priority
        if (hands.length === 2) {
            const twoHandGesture = this.analyzeTwoHands(hands[0], hands[1]);
            if (twoHandGesture !== 'neutral') {
                return this.updateBuffer(twoHandGesture);
            }
        }

        // Single hand: pick first non-neutral result from any hand
        for (const lm of hands) {
            const result = this.analyzeHand(lm);
            if (result.gesture !== 'neutral') {
                return this.updateBuffer(result.gesture);
            }
        }

        return this.updateBuffer('neutral');
    }

    /**
     * Analyzes a single hand's landmarks
     */
    analyzeHand(lm) {
        // 1. Calculate Hand Scale (Reference: Wrist to Middle Finger Base)
        const handScale = this.getDist(lm[0], lm[9]);
        
        // 2. Finger State Checks
        const isExtended = (tip, mcp) => this.getDist(lm[0], lm[tip]) > this.getDist(lm[0], lm[mcp]) * 1.25;

        // STRICT fist curl: tip must be VERY close to its own MCP base
        // Extended finger: tip-to-mcp ≈ 1.5-2.0x handScale
        // Curled fist finger: tip-to-mcp ≈ 0.3-0.6x handScale
        // Threshold 0.70 gives clear separation — only a real fist passes
        const isFistCurled = (tip, mcp) => this.getDist(lm[tip], lm[mcp]) < handScale * 0.70;

        const idxExt  = isExtended(8, 5);
        const midExt  = isExtended(12, 9);
        const ringExt = isExtended(16, 13);
        const pinkExt = isExtended(20, 17);

        const idxFist  = isFistCurled(8, 5);
        const midFist  = isFistCurled(12, 9);
        const ringFist = isFistCurled(16, 13);
        const pinkFist = isFistCurled(20, 17);

        // Wrist-relative curl (for gestures where some fingers are up and others down)
        const isCurled   = (tip, mcp) => this.getDist(lm[0], lm[tip]) < this.getDist(lm[0], lm[mcp]) * 1.1;
        const midCurled  = isCurled(12, 9);
        const ringCurled = isCurled(16, 13);
        const pinkCurled = isCurled(20, 17);

        // 3. Pinch Detection
        const pinchDist  = this.getDist(lm[4], lm[8]);
        const isPinching = pinchDist < handScale * 0.55;
        
        // 4. Thumb Extension (Discriminator for Red vs Ratio)
        const thumbTipToPinkyBase = this.getDist(lm[4], lm[17]);
        const isThumbExtended = thumbTipToPinkyBase > handScale * 1.2;

        // 5. Crossing Check (Infinite Void)
        const tipDist    = this.getDist(lm[8], lm[12]);
        const baseDist   = this.getDist(lm[5], lm[9]);
        const isCrossing = tipDist < baseDist * 0.75;

        // --- Priority Logic ---

        // INFINITE VOID: index & middle crossed, ring & pinky curled
        if (idxExt && midExt && isCrossing && ringCurled && pinkCurled) return { gesture: 'void' };

        // HOLLOW PURPLE: pinch + other 3 clearly extended
        if (isPinching && midExt && ringExt && pinkExt) return { gesture: 'purple' };

        // BLACK FLASH: ALL 4 fingertips strictly close to their own base joints
        if (idxFist && midFist && ringFist && pinkFist) return { gesture: 'blackflash' };

        // RED: index up, other 3 curled, THUMB TUCKED
        if (idxExt && midCurled && ringCurled && pinkCurled && !isThumbExtended) return { gesture: 'red' };

        // RATIO: index up, other 3 curled, THUMB EXTENDED (L-shape)
        if (idxExt && midCurled && ringCurled && pinkCurled && isThumbExtended) return { gesture: 'ratio' };

        // MALEVOLENT SHRINE: flat open hand
        if (idxExt && midExt && ringExt && pinkExt) return { gesture: 'shrine' };

        // CLEAVE: index + middle + ring up, pinky down
        if (idxExt && midExt && ringExt && !pinkExt) return { gesture: 'cleave' };

        return { gesture: 'neutral' };
    }

    /**
     * Analyzes spatial relationship between two hands
     */
    analyzeTwoHands(h1, h2) {
        const h1Scale = this.getDist(h1[0], h1[9]);
        const h2Scale = this.getDist(h2[0], h2[9]);
        const avgScale = (h1Scale + h2Scale) / 2;

        const palmDist  = this.getDist(h1[0], h2[0]);
        const thumbDist = this.getDist(h1[4], h2[4]);
        const index1Tip = h1[8];
        const index2Tip = h2[8];
        const indexDist = this.getDist(index1Tip, index2Tip);

        // SHADOW GARDEN: Wrists crossed (palms facing self), fingers spread
        if (palmDist < avgScale * 0.8 && Math.abs(h1[12].y - h2[12].y) < avgScale * 0.5) {
            return 'shadowgarden';
        }

        // MAHORAGA: Thumbs touching, hands upright, WRISTS CLOSE
        const h1Upright = h1[8].y < h1[0].y;
        const h2Upright = h2[8].y < h2[0].y;
        if (thumbDist < avgScale * 0.8 && palmDist < avgScale * 1.2 && h1Upright && h2Upright) {
            return 'mahoraga';
        }

        // FUGA: thumbs close together, WRISTS SPREAD APART
        if (thumbDist < avgScale * 0.8 && palmDist > avgScale * 1.6) {
            return 'fuga';
        }

        // NUE: wrists crossed close together, index fingertips spread far apart (wing shape)
        if (palmDist < avgScale * 1.2 && indexDist > avgScale * 2.0) {
            return 'nue';
        }

        // BOOGIE WOOGIE: actual clap — palms nearly touching
        if (palmDist < avgScale * 0.6) {
            return 'boogie';
        }

        // WORLD CUTTING SLASH: hands moderately close, both index fingers pointing up & parallel
        if (palmDist < avgScale * 2.5 && indexDist < avgScale * 1.2 &&
            index1Tip.y < h1[0].y && index2Tip.y < h2[0].y) {
            return 'worldslash';
        }

        // SHRINE (Prayer): palms pressed together
        if (palmDist < avgScale * 0.9) {
            return 'shrine';
        }

        return 'neutral';
    }

    /**
     * Smooths detection using a rolling buffer and confidence threshold
     */
    updateBuffer(gesture) {
        this.gestureBuffer.push(gesture);
        if (this.gestureBuffer.length > this.bufferSize) {
            this.gestureBuffer.shift();
        }

        const counts = {};
        this.gestureBuffer.forEach(g => counts[g] = (counts[g] || 0) + 1);
        
        let mostFrequent = 'neutral';
        let maxCount = 0;
        
        for (const g in counts) {
            if (counts[g] > maxCount) {
                maxCount = counts[g];
                mostFrequent = g;
            }
        }

        // Only switch if confidence is high enough
        if (maxCount >= this.bufferSize * this.confidenceThreshold) {
            this.lastGesture = mostFrequent;
        }

        return this.lastGesture;
    }

    getDist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
    }
}
