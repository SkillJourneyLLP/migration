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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }
    // Build prompt for generating questions
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
    console.log("Generating interview questions via Lovable AI...");
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: "You are an expert interviewer that generates high-quality interview questions. Always respond with valid JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Lovable AI error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({
          error: "Rate limit exceeded. Please try again later."
        }), {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({
          error: "Payment required. Please add credits to your workspace."
        }), {
          status: 402,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      throw new Error(`Lovable AI request failed: ${errorText}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("Invalid AI response:", data);
      throw new Error("Invalid response from AI");
    }
    // Parse JSON from response - handle potential markdown wrapping
    let parsedQuestions;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedQuestions = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("AI returned invalid JSON format");
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
