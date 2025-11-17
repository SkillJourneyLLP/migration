import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { constraints, resumeSummary } = await req.json();
    if (!constraints || !Array.isArray(constraints)) {
      return new Response(JSON.stringify({
        error: "Missing or invalid constraints array"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    const prompt = `You are an expert interviewer. Generate exactly 3 interview questions for each of the following constraints.

Resume Summary: ${resumeSummary || "Not provided"}

Constraints:
${constraints.map((c, idx)=>`${idx + 1}. Type: ${c.type}, Difficulty: ${c.difficulty}${c.topic ? `, Topic: ${c.topic}` : ""}`).join("\n")}

IMPORTANT:
- Generate 3 distinct, high-quality questions for each constraint
- Questions should match the specified difficulty level
- For Resume-based or Behavioral constraints, reference the resume summary
- For Technical or Coding constraints, focus on the specific topic and difficulty
- Return ONLY valid JSON in this exact format with no additional text:

{
  "constraints": [
    {
      "type": "constraint_type",
      "difficulty": "difficulty_level",
      "topic": "topic_name",
      "questions": [
        "Question 1",
        "Question 2",
        "Question 3"
      ]
    }
  ]
}`;
    console.log("Generating interview questions via Gemini API...");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.8
        }
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(`Gemini request failed: ${errorText}`);
    }
    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      console.error("Invalid Gemini response:", data);
      throw new Error("Invalid response from Gemini API");
    }
    // Clean + parse JSON
    let parsedQuestions;
    try {
      const cleanContent = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsedQuestions = JSON.parse(cleanContent);
    } catch (err) {
      console.error("Failed to parse Gemini response:", content);
      throw new Error("Gemini returned invalid JSON format");
    }
    console.log("Interview questions generated successfully");
    return new Response(JSON.stringify({
      success: true,
      data: parsedQuestions
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in generate-interview-questions:", error);
    return new Response(JSON.stringify({
      error: "Failed to generate interview questions",
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
