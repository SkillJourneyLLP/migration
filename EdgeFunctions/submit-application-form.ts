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
// Function to upload resume to Supabase storage
async function uploadResumeToSupabase(supabase, resumePdfBase64, email, interviewId) {
  try {
    // Convert base64 to binary data
    const bytes = base64ToUint8Array(resumePdfBase64);
    const fileSize = bytes.length;
    console.log(`Resume file size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    // Generate filename in the format: interviewId-email.pdf
    const filename = `${interviewId}-${email}.pdf`;
    // Upload to Supabase storage bucket 'resume'
    const { data, error } = await supabase.storage.from('resume').upload(filename, bytes, {
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true // Allow overwriting if candidate reapplies
    });
    if (error) {
      console.error('Supabase storage upload error:', error);
      throw new Error(`Failed to upload resume to storage: ${error.message}`);
    }
    console.log(`Resume uploaded successfully to Supabase storage: ${filename}`);
    return {
      filename: filename,
      success: true
    };
  } catch (error) {
    console.error('Error uploading resume to Supabase storage:', error);
    throw error;
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
    const { name, email, phoneNumber, location, currentCtc, expectedCtc, gender, availability, workPreference, resumePdfBase64, accessToken, refererName, refererEmail } = await req.json();
    if (!name || !email || !phoneNumber || !location || !expectedCtc || !gender || !resumePdfBase64 || !accessToken) {
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
    // Upload resume to Supabase storage
    let resumeUploadResult = null;
    try {
      resumeUploadResult = await uploadResumeToSupabase(supabase, resumePdfBase64, email, interviewId);
      console.log('Resume uploaded to Supabase storage successfully:', resumeUploadResult.filename);
    } catch (uploadError) {
      console.error('Error uploading resume to Supabase storage:', uploadError);
    // You can decide whether to continue with the application or return an error
    // For now, we'll continue but log the error
    }
    // Insert candidate data
    const candidateInsertData = {
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
      username,
      referer_name: refererName || null,
      referer_email: refererEmail || null,
      is_referred: false
    };
    const { data: candidateData, error: candidateError } = await supabase.from('candidate').insert(candidateInsertData).select().single();
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
    const responseData = {
      success: true,
      message: 'Application submitted successfully',
      interviewLink: linkData.link,
      username,
      candidateId: candidateData.id,
      interviewId: interviewId
    };
    return new Response(JSON.stringify(responseData), {
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
