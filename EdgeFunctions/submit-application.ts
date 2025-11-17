import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jwt from "https://deno.land/x/djwt@v2.9.1/mod.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Base64 helpers to support data URLs and missing padding
function normalizeBase64(input) {
  // If it's a data URL, take the part after the comma
  const base64Part = input.startsWith('data:') ? input.split(',')[1] ?? '' : input;
  // Remove whitespace and convert URL-safe base64 to standard
  const sanitized = base64Part.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const paddingNeeded = (4 - sanitized.length % 4) % 4;
  return sanitized + '='.repeat(paddingNeeded);
}
function base64ToUint8Array(input) {
  const base64 = normalizeBase64(input);
  let binaryString;
  try {
    binaryString = atob(base64);
  } catch (e) {
    console.error('Failed to decode base64. Length:', base64.length);
    throw e;
  }
  const bytes = new Uint8Array(binaryString.length);
  for(let i = 0; i < binaryString.length; i++){
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
// Function to upload resume to external endpoint with chunking support
async function uploadResumeToEndpoint(resumePdfBase64, email, interviewId) {
  const EXTERNAL_ENDPOINT = 'https://staging-northstar.azurewebsites.net/api/v1/upload_video';
  const CHUNK_SIZE = 90 * 1024 * 1024; // 90MB in bytes
  // Convert base64 to binary data (supports data URLs and missing padding)
  const bytes = base64ToUint8Array(resumePdfBase64);
  const fileSize = bytes.length;
  console.log(`Resume file size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
  // Generate filename based on interviewId and email
  const filename = `${interviewId}_${email.replace(/[^a-zA-Z0-9@.-]/g, '_')}_resume.pdf`;
  if (fileSize <= CHUNK_SIZE) {
    // Upload as single file
    await uploadChunk(bytes, filename, EXTERNAL_ENDPOINT, 0, 1);
  } else {
    // Split into chunks and upload
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    console.log(`File size exceeds 90MB, splitting into ${totalChunks} chunks`);
    for(let i = 0; i < totalChunks; i++){
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileSize);
      const chunk = bytes.slice(start, end);
      const chunkFilename = `${interviewId}_${email.replace(/[^a-zA-Z0-9@.-]/g, '_')}_resume_part${i + 1}of${totalChunks}.pdf`;
      await uploadChunk(chunk, chunkFilename, EXTERNAL_ENDPOINT, i, totalChunks);
    }
  }
}
// Function to upload a single chunk
async function uploadChunk(data, filename, endpoint, chunkIndex, totalChunks) {
  const formData = new FormData();
  const blob = new Blob([
    data
  ], {
    type: 'application/pdf'
  });
  formData.append('file', blob, filename);
  console.log(`Uploading ${filename} (chunk ${chunkIndex + 1}/${totalChunks})...`);
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed for ${filename}: ${response.status} ${response.statusText} - ${errorText}`);
  }
  const result = await response.json();
  console.log(`Upload successful for ${filename}:`, result);
  if (!result.success) {
    throw new Error(`Upload failed for ${filename}: ${result.message || 'Unknown error'}`);
  }
}
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { name, email, phoneNumber, location, currentCtc, expectedCtc, gender, availability, workPreference, resumePdfBase64, accessToken } = await req.json();
    if (!name || !email || !phoneNumber || !location || !expectedCtc || !gender || !availability || !resumePdfBase64 || !accessToken) {
      return new Response(JSON.stringify({
        error: 'Missing required fields'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Decode the access token to get interview details
    const jwtSecret = Deno.env.get('JWT_SECRET');
    if (!jwtSecret) {
      console.error('JWT_SECRET not configured');
      return new Response(JSON.stringify({
        error: 'Server configuration error'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(jwtSecret), {
      name: "HMAC",
      hash: "SHA-256"
    }, false, [
      "sign",
      "verify"
    ]);
    let payload;
    try {
      payload = await jwt.verify(accessToken, key);
    } catch (error) {
      console.error('Invalid access token:', error);
      return new Response(JSON.stringify({
        error: 'Invalid access token'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const interviewId = payload.interviewId;
    if (!interviewId) {
      return new Response(JSON.stringify({
        error: 'Invalid token: missing interview ID'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check if candidate already applied for this interview
    const { data: existingCandidate, error: checkError } = await supabase.from('candidate').select('id, email').eq('email', email).eq('interview_id', interviewId).maybeSingle();
    if (checkError) {
      console.error('Error checking for existing application:', checkError);
      return new Response(JSON.stringify({
        error: 'Failed to verify application status'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (existingCandidate) {
      console.log(`Duplicate application attempt for email: ${email}, interview: ${interviewId}`);
      return new Response(JSON.stringify({
        error: 'Application already submitted',
        message: 'You have already submitted an application for this interview position.'
      }), {
        status: 409,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Generate unique username (using timestamp + random string)
    const timestamp = Date.now().toString(36);
    const randomString = Math.random().toString(36).substring(2, 8);
    const username = `user_${timestamp}_${randomString}`;
    console.log(`Generated username: ${username} for email: ${email}`);
    // Process resume PDF with Gemini to generate summary
    const { data: resumeData, error: resumeError } = await supabase.functions.invoke('process-resume-pdf', {
      body: {
        pdfBase64: resumePdfBase64
      }
    });
    if (resumeError || !resumeData?.success) {
      console.error('Error processing resume:', resumeError);
      return new Response(JSON.stringify({
        error: 'Failed to process resume PDF'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const resumeSummary = resumeData.resumeSummary;
    console.log('Resume summary generated successfully');
    // Upload resume to external endpoint
    try {
      await uploadResumeToEndpoint(resumePdfBase64, email, interviewId);
      console.log('Resume uploaded to external endpoint successfully');
    } catch (uploadError) {
      console.error('Error uploading resume to external endpoint:', uploadError);
    // Continue with application submission even if external upload fails
    }
    // Insert candidate data
    const { data: candidateData, error: candidateError } = await supabase.from('candidate').insert({
      interview_id: interviewId,
      name,
      email,
      phone: phoneNumber,
      location,
      current_ctc: currentCtc || null,
      expected_ctc: expectedCtc,
      gender,
      availability,
      work_preference: workPreference || null,
      resume_summary: resumeSummary,
      username
    }).select().single();
    if (candidateError) {
      console.error('Error inserting candidate:', candidateError);
      return new Response(JSON.stringify({
        error: 'Failed to save application'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Generate interview link using the existing function
    const { data: linkData, error: linkError } = await supabase.functions.invoke('generate-interview-link', {
      body: {
        username
      }
    });
    if (linkError || !linkData?.success) {
      console.error('Error generating interview link:', linkError);
      return new Response(JSON.stringify({
        error: 'Failed to generate interview link'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Update candidate record with the interview link
    const { error: updateError } = await supabase.from('candidate').update({
      link: linkData.link
    }).eq('id', candidateData.id);
    if (updateError) {
      console.error('Error updating candidate with link:', updateError);
      return new Response(JSON.stringify({
        error: 'Failed to update application with interview link'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Application submitted successfully for ${name} (${email})`);
    console.log(`Interview link: ${linkData.link}`);
    return new Response(JSON.stringify({
      success: true,
      message: 'Application submitted successfully',
      interviewLink: linkData.link,
      username
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error processing application:', error);
    return new Response(JSON.stringify({
      error: 'Failed to process application'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
