// supabase/functions/resume-summary/index.ts
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  // ✅ Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    // ✅ Parse request body safely
    const body = await req.json().catch(()=>null);
    if (!body || !body.pdfBase64) {
      return new Response(JSON.stringify({
        error: "Missing required field: pdfBase64"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { pdfBase64 } = body;
    // ✅ Get Gemini API key
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY in environment variables");
    }
    // ✅ Clean base64 input (strip data: prefix if present)
    const base64Data = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;
    console.log("Sending resume PDF to Gemini API...");
    // ✅ Gemini API request
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: "Summarize this resume in 2–3 short paragraphs highlighting:\n" + "1. Key skills and expertise\n" + "2. Notable work experience and achievements\n" + "3. Educational background and certifications\n\n" + "Keep it concise and professional for job applications. Just provide the summary. NO other words starting and tailing the summary like 'Of course'."
              },
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048 // 🔼 Increased so Gemini doesn't cut off
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return new Response(JSON.stringify({
        error: "Gemini API request failed",
        details: errorText
      }), {
        status: response.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const data = await response.json();
    // ✅ Safely extract AI response (join all parts if multiple)
    const parts = data?.candidates?.[0]?.content?.parts;
    const resumeSummary = parts?.map((p)=>p.text).join("\n") || null;
    if (!resumeSummary) {
      console.error("Invalid Gemini response:", data);
      return new Response(JSON.stringify({
        error: "Failed to generate resume summary"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.log("Resume summary generated successfully ✅");
    return new Response(JSON.stringify({
      success: true,
      resumeSummary
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in resume-summary function:", error);
    return new Response(JSON.stringify({
      error: "Failed to process resume PDF",
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
