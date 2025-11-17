import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { fileUrl } = await req.json();
    if (!fileUrl) {
      return new Response(JSON.stringify({
        error: 'File URL is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      console.error('GEMINI_API_KEY not found');
      return new Response(JSON.stringify({
        error: 'API key not configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Download the PDF file
    console.log('Downloading PDF from:', fileUrl);
    const pdfResponse = await fetch(fileUrl);
    if (!pdfResponse.ok) {
      throw new Error('Failed to download PDF');
    }
    const pdfBuffer = await pdfResponse.arrayBuffer();
    console.log('PDF size:', pdfBuffer.byteLength, 'bytes');
    // Check file size (warn if > 10MB)
    if (pdfBuffer.byteLength > 10 * 1024 * 1024) {
      console.warn('Large PDF detected, this may take longer or fail');
    }
    const base64Pdf = base64Encode(new Uint8Array(pdfBuffer));
    // Prepare Gemini API request for PDF analysis
    const prompt = `You are an AI assistant specialized in analyzing job descriptions. 
Please read the provided job description PDF and create a comprehensive summary under 200 words.

The summary should include:
1. Job title and department
2. Key responsibilities (3-5 main points)
3. Required qualifications and skills
4. Experience level required
5. Any notable benefits or requirements

Keep the summary concise, professional, and well-structured.

The response should be in markdown format.`;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${geminiApiKey}`;
    console.log('Calling Gemini API for PDF analysis...');
    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              },
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: base64Pdf
                }
              }
            ]
          }
        ]
      })
    });
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', geminiResponse.status, errorText);
      let errorMessage = `Gemini API error: ${geminiResponse.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch  {
        // If not JSON, use the raw text
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    const geminiData = await geminiResponse.json();
    console.log('Gemini API response received');
    if (!geminiData.candidates || geminiData.candidates.length === 0) {
      throw new Error('No response from Gemini API');
    }
    const summary = geminiData.candidates[0].content.parts[0].text;
    return new Response(JSON.stringify({
      success: true,
      summary: summary.trim()
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in generate-jd-summary:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      success: false
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
