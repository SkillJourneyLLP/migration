// supabase/functions/analyze-interview/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.21.0";
// --- Configuration ---
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
if (!GEMINI_API_KEY) throw new Error("❌ GEMINI_API_KEY not set");
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// --- CORS Headers ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// FFmpeg compression helper
async function compressVideo(inputPath, outputPath) {
  console.log("🎬 Compressing video to 240p...");
  const command = new Deno.Command("ffmpeg", {
    args: [
      "-i",
      inputPath,
      "-vf",
      "scale=-2:240",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-r",
      "15",
      "-y",
      outputPath
    ],
    stdout: "piped",
    stderr: "piped"
  });
  const process = command.spawn();
  const { code, stderr } = await process.output();
  if (code !== 0) {
    const errorText = new TextDecoder().decode(stderr);
    throw new Error(`FFmpeg failed: ${errorText}`);
  }
  console.log("✅ Video compressed successfully");
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const tempFiles = [];
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({
        error: "Use POST method"
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { video_url, candidate_id = "unknown", session_id = `session_${Date.now()}`, skip_compression = false } = await req.json();
    if (!video_url) {
      return new Response(JSON.stringify({
        error: "video_url is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log(`📹 Fetching video: ${video_url}`);
    // --- STEP 1: Download video ---
    const fileResponse = await fetch(video_url);
    if (!fileResponse.ok) {
      throw new Error(`Failed to fetch video: ${fileResponse.statusText}`);
    }
    const mimeType = fileResponse.headers.get("content-type") ?? "video/mp4";
    // Save original video to temp file
    const tempDir = await Deno.makeTempDir();
    const inputPath = `${tempDir}/input.mp4`;
    const outputPath = `${tempDir}/output.mp4`;
    tempFiles.push(inputPath, outputPath);
    console.log("💾 Downloading video...");
    const videoData = await fileResponse.arrayBuffer();
    await Deno.writeFile(inputPath, new Uint8Array(videoData));
    const inputSize = (await Deno.stat(inputPath)).size;
    console.log(`✅ Downloaded: ${(inputSize / 1024 / 1024).toFixed(2)} MB`);
    // --- STEP 2: Compress video if needed ---
    let uploadPath = inputPath;
    if (!skip_compression && inputSize > 20 * 1024 * 1024) {
      try {
        await compressVideo(inputPath, outputPath);
        const outputSize = (await Deno.stat(outputPath)).size;
        console.log(`✅ Compressed: ${(outputSize / 1024 / 1024).toFixed(2)} MB (${((1 - outputSize / inputSize) * 100).toFixed(1)}% reduction)`);
        uploadPath = outputPath;
      } catch (compressionError) {
        console.warn("⚠️ Compression failed, using original:", compressionError);
        uploadPath = inputPath;
      }
    }
    // --- STEP 3: Upload to Gemini ---
    console.log("📤 Uploading to Gemini...");
    const uploadData = await Deno.readFile(uploadPath);
    const uploadResult = await genAI.files.uploadFile({
      file: {
        data: uploadData,
        mimeType: mimeType
      },
      displayName: `${session_id}.mp4`
    });
    console.log(`✅ Uploaded: ${uploadResult.file.uri}`);
    // Wait for processing
    let file = uploadResult.file;
    let attempts = 0;
    const MAX_ATTEMPTS = 60;
    while(file.state === "PROCESSING" && attempts < MAX_ATTEMPTS){
      console.log(`⏳ Processing... (${attempts + 1}/${MAX_ATTEMPTS})`);
      await new Promise((resolve)=>setTimeout(resolve, 2000));
      file = await genAI.files.getFile(file.name);
      attempts++;
    }
    if (file.state === "FAILED") {
      throw new Error("Video processing failed");
    }
    if (file.state === "PROCESSING") {
      throw new Error("Video processing timeout");
    }
    console.log("✅ File ready for analysis");
    // --- STEP 4: Analyze with Gemini ---
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.4,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string"
            },
            candidate_id: {
              type: "string"
            },
            total_duration: {
              type: "string"
            },
            summary: {
              type: "object",
              properties: {
                total_violations: {
                  type: "integer"
                },
                major_violations: {
                  type: "integer"
                },
                minor_violations: {
                  type: "integer"
                },
                risk_score: {
                  type: "number"
                },
                confidence: {
                  type: "number"
                }
              },
              required: [
                "total_violations",
                "risk_score",
                "confidence"
              ]
            },
            violations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string"
                  },
                  timestamp_start: {
                    type: "string"
                  },
                  timestamp_end: {
                    type: "string"
                  },
                  severity: {
                    type: "string"
                  },
                  confidence: {
                    type: "number"
                  },
                  description: {
                    type: "string"
                  }
                },
                required: [
                  "type",
                  "timestamp_start",
                  "severity",
                  "description"
                ]
              }
            },
            overall_observation: {
              type: "string"
            },
            final_recommendation: {
              type: "string"
            }
          }
        }
      },
      systemInstruction: `You are an AI Interview Proctoring Analyzer. Analyze the video for malpractice or anomalies during a remote interview.

Violation types to detect:
- Face Detection Issues: Face not visible, obscured, or partially in frame
- Gaze Diversion: Frequently looking away from screen (reading from another source)
- Multiple People: More than one person detected in frame
- External Devices: Using phone, tablet, or unauthorized electronic device
- Audio Anomalies: Whispering, speech from another person, suspicious background noise

Return JSON conforming to schema. If no issues found, return empty violations array, risk_score of 0, and "Pass" recommendation.`
    });
    console.log("🤖 Analyzing video...");
    const result = await model.generateContent([
      {
        text: `Analyze this interview recording for candidate ${candidate_id}, session ${session_id}.`
      },
      {
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri
        }
      }
    ]);
    const analysisJson = result.response.text();
    // Cleanup
    try {
      await genAI.files.deleteFile(file.name);
      console.log("🗑️ Cleaned up Gemini file");
    } catch (e) {
      console.warn("⚠️ Cleanup warning:", e);
    }
    return new Response(analysisJson, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("❌ Error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({
      error: errorMessage,
      details: err instanceof Error ? err.stack : undefined
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } finally{
    // Cleanup temp files
    for (const file of tempFiles){
      try {
        await Deno.remove(file);
      } catch (e) {
      // Ignore cleanup errors
      }
    }
  }
});
