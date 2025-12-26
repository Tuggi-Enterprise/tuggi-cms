# Architecture Analysis: Gemini 2.0 Flash Native Audio Implementation

## 1. Executive Summary

The objective is to modernize the **Contextual Audio Generation** pipeline by leveraging **Google Gemini 2.0 Flash's Native Audio capabilities**.
**Strategy Change (User Feedback)**: Shift from "Pre-fetch in Cone" to **"Just-in-Time (JIT) Generation at Trigger Point"**.
We accept that the *first* user to hit a fresh context might get the "Generic" audio if generation takes too long, but we prioritize **zero latency** and **robustness**. The generated asset is cached for the *next* user.

## 2. New Workflow: JIT with Fallback

### The "Race" Logic
When the user enters the Trigger Point (radius ~20m):
1.  **Immediate Action**: Check **Local Cache** for a matching Context Signature.
    *   **Hit**: Play immediately.
    *   **Miss**: Start **Race Condition**.

2.  **The Race**:
    *   **Runner A (Generation)**: Call `generate-native-narration` (Supabase Edge Function).
    *   **Runner B (Timeout)**: Start a 3-5 second timer.

3.  **Outcome**:
    *   **If Runner A wins**: Receive JSON `{ audio_url, text }`. Play audio immediately (Stream/Download).
    *   **If Runner B wins**: **FALLBACK**. Play the "Generic/Static" audio for that POI immediately.
        *   *Background*: Runner A continues running on the server. The audio is generated and saved to Supabase Storage.
        *   *Result*: The **NEXT** user (or this user if they return) will get the high-quality AI audio (Cache Hit).

## 3. Streaming vs. Downloading (Native Player Update)

To support the "Runner A wins" scenario effectively, we must minimize "Time to First Sound".
*   **Current State**: iOS player forces full download.
*   **Required Change**: Update `TuggiAudioPlayer` (iOS) and `TuggiAudioPlayerModule` (Android) to support **Streaming**.
    *   **iOS**: Switch from `AVAudioPlayer` (requires local file) to `AVPlayer` (supports HTTP Streaming) OR simply allow `AVAudioPlayer` to attempt remote URL (less reliable).
    *   **Recommendation**: Implement a `playStream(url)` method in the native modules that uses the optimal streaming API for each platform.

## 4. Implementation Details

### A. Server-Side (Supabase Edge Function)
*   **Function**: `generate-native-narration`
*   **Logic**:
    1.  Receive Context.
    2.  Calculate Hash.
    3.  **Check Storage**: If exists, return Public URL immediately.
    4.  **Generate**: Call Gemini 2.0 Flash.
    5.  **Save**: Upload to Storage (Async/Background if possible, but Edge Functions usually need to await).
    6.  **Return**: URL.

### B. Client-Side (React Native)
*   **Service**: `AiGuideService.ts`.
*   **Trigger**: Move logic from `update()` (Cone scanning) to `onTriggerPointEnter()` (Event driven).
*   **Fallback Logic**:
    ```typescript
    try {
       const result = await Promise.race([
          api.generateAudio(context),
          new Promise((_, reject) => setTimeout(() => reject('TIMEOUT'), 4000))
       ]);
       playStream(result.audio_url);
    } catch (e) {
       playGenericAudio(); // Immediate fallback
    }
    ```

### C. Caching Strategy
*   **Key**: SHA-256(POI + TimeBucket + Weather + UserType).
*   **Storage**: Supabase Storage bucket `generated-audio-cache`.
*   **TTL**: 5-7 Days.
*   **Cleanup**: Scheduled DB cron job.

## 5. Action Plan

1.  **Backend**: Create `generate-native-narration` Edge Function.
2.  **Native**: Update `TuggiAudioPlayer` (iOS/Android) to add `playStream()` capability.
3.  **Client**: Refactor `AiGuideService.ts` to implement the "Race" logic and remove Cone pre-fetching.

---
**Status**: Backend implemented (generate-native-narration). Ready for Client-side integration.

