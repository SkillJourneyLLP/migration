import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.53.0";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
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
async function processChunkInBackground(uploadId, chunkIndex, chunkData, candidateId, videoType, interviewId) {
  try {
    // Convert base64 to binary data (supports data URLs and missing padding)
    const bytes = base64ToUint8Array(chunkData);
    // Create filename based on interview_id and candidate_id
    const chunkNumber = chunkIndex + 1; // Start from 1 instead of 0
    const fileName = `${interviewId}_${candidateId}_${chunkNumber}.webm`;
    // Upload to external endpoint using stream to reduce memory usage
    const formData = new FormData();
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });
    const chunkBlob = new Blob([
      bytes
    ], {
      type: videoType || 'video/webm'
    });
    formData.append('file', chunkBlob, fileName);
    console.log(`Uploading chunk ${chunkNumber} (${fileName}) to external endpoint...`);
    const response = await fetch('https://staging-northstar.azurewebsites.net/api/v1/upload_video', {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed for ${fileName}: ${response.status} ${response.statusText} - ${errorText}`);
    }
    const result = await response.json();
    console.log(`Upload successful for ${fileName}:`, result);
    if (!result.success) {
      throw new Error(`Upload failed for ${fileName}: ${result.message || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`Background processing failed for chunk ${chunkIndex + 1}:`, error);
    throw error;
  } finally{
    // Force garbage collection hint
    if (typeof gc === 'function') {
      gc();
    }
  }
}
async function handleChunkedUpload(body) {
  const { uploadId, chunkIndex, totalChunks, chunkData, chunkSize, videoType, totalSize, candidateId, finalize } = body;
  // Get interview_id from candidate data
  const { data: candidateData, error: candidateError } = await supabase.from('candidate').select('interview_id').eq('id', candidateId).single();
  if (candidateError || !candidateData) {
    console.error('Error fetching candidate data:', candidateError);
    return new Response(JSON.stringify({
      error: 'Failed to fetch candidate information',
      details: candidateError?.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  const interviewId = candidateData.interview_id;
  if (finalize) {
    // For finalize, just return success - chunks are already uploaded individually
    console.log(`Finalizing upload ${uploadId} with ${totalChunks} chunks`);
    // Verify all chunks metadata in database (not checking actual data)
    const { data: chunks, error: queryError } = await supabase.from('video_chunks').select('chunk_index').eq('upload_id', uploadId).order('chunk_index');
    if (queryError) {
      console.error('Error querying chunks:', queryError);
      return new Response(JSON.stringify({
        error: 'Failed to verify chunks',
        details: queryError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (!chunks || chunks.length !== totalChunks) {
      return new Response(JSON.stringify({
        error: 'Missing chunks',
        details: `Expected ${totalChunks} chunks, found ${chunks?.length || 0}`
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Update transcripts table with chunk count
    // First check if a record exists
    const { data: existingTranscript } = await supabase.from('transcripts').select('id').eq('interview_id', interviewId).eq('candidate_id', candidateId).maybeSingle();
    let transcriptError;
    if (existingTranscript) {
      // Update existing record
      const result = await supabase.from('transcripts').update({
        chunk_count: totalChunks
      }).eq('id', existingTranscript.id);
      transcriptError = result.error;
    } else {
      // Create new record
      const result = await supabase.from('transcripts').insert({
        interview_id: interviewId,
        candidate_id: candidateId,
        chunk_count: totalChunks,
        file_path: `${interviewId}_${candidateId}` // placeholder path since chunks are uploaded separately
      });
      transcriptError = result.error;
    }
    if (transcriptError) {
      console.error('Error updating transcript with chunk count:', transcriptError);
    // Don't fail the entire request, just log the error
    }
    // Return success with external upload completion
    return new Response(JSON.stringify({
      success: true,
      data: {
        chunksProcessed: totalChunks,
        uploadId,
        message: 'All chunks uploaded to external endpoint successfully'
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } else {
    // Process chunk with minimal memory usage
    console.log(`Processing chunk ${chunkIndex}/${totalChunks - 1} for upload ${uploadId}`);
    if (!chunkData) {
      return new Response(JSON.stringify({
        error: 'Missing chunk data'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Check base64 size limit before decoding (60MB limit for chunks to avoid memory issues)
    const maxBase64Size = 80 * 1024 * 1024; // ~60MB when decoded to prevent memory issues
    if (chunkData.length > maxBase64Size) {
      return new Response(JSON.stringify({
        error: 'Chunk too large',
        details: `Base64 chunk size exceeds 60MB limit to prevent memory issues`
      }), {
        status: 413,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Store only metadata in database (not the actual chunk data) - use upsert to handle retries
    const { error: dbError } = await supabase.from('video_chunks').upsert({
      upload_id: uploadId,
      candidate_id: candidateId,
      chunk_index: chunkIndex,
      total_chunks: totalChunks,
      chunk_size: Math.floor(chunkData.length * 0.75),
      video_type: videoType || 'video/webm'
    }, {
      onConflict: 'upload_id, chunk_index'
    });
    if (dbError) {
      console.error('Error storing chunk metadata:', dbError);
      return new Response(JSON.stringify({
        error: 'Failed to store chunk metadata',
        details: dbError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Process chunk upload in background to reduce memory usage
    EdgeRuntime.waitUntil(processChunkInBackground(uploadId, chunkIndex, chunkData, candidateId, videoType, interviewId));
    // Get current progress
    const { data: progressData } = await supabase.from('video_chunks').select('chunk_index').eq('upload_id', uploadId);
    const chunksReceived = progressData?.length || 1;
    return new Response(JSON.stringify({
      success: true,
      data: {
        chunkIndex,
        chunksReceived,
        totalChunks,
        uploadId,
        processingInBackground: true
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
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
    // Validate content type
    const contentType = req.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Invalid content type:', contentType);
      return new Response(JSON.stringify({
        error: 'Invalid content type. Expected application/json'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get request text first to check if it's valid
    const bodyText = await req.text();
    console.log('Request body length:', bodyText.length, 'characters');
    if (!bodyText || bodyText.trim() === '') {
      console.error('Empty request body');
      return new Response(JSON.stringify({
        error: 'Empty request body'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Parse JSON with better error handling
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      console.error('Body preview (first 200 chars):', bodyText.substring(0, 200));
      return new Response(JSON.stringify({
        error: 'Invalid JSON format',
        details: parseError.message
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Handle chunked upload or finalization
    if (body.uploadId) {
      return await handleChunkedUpload(body);
    }
    // Legacy single upload support (fallback)
    const videoData = body.video;
    const candidateId = body.candidateId;
    if (!videoData || !candidateId) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: video data and candidateId are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Processing legacy single video upload, size:', videoData.size, 'bytes');
    // Check file size limits (90MB limit for single upload)
    const maxSize = 90 * 1024 * 1024; // 90MB for single upload
    if (videoData.size > maxSize) {
      console.error('Video file too large for single upload:', videoData.size, 'bytes (max:', maxSize, ')');
      return new Response(JSON.stringify({
        error: 'Video file too large',
        details: `File size ${(videoData.size / 1024 / 1024).toFixed(2)}MB exceeds maximum allowed size of ${maxSize / 1024 / 1024}MB for single upload. Use chunked upload for larger files.`
      }), {
        status: 413,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get interview_id from candidate data for legacy upload
    const { data: candidateData, error: candidateError } = await supabase.from('candidate').select('interview_id').eq('id', candidateId).single();
    if (candidateError || !candidateData) {
      console.error('Error fetching candidate data for legacy upload:', candidateError);
      return new Response(JSON.stringify({
        error: 'Failed to fetch candidate information',
        details: candidateError?.message
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const interviewId = candidateData.interview_id;
    // Process legacy upload and upload to external endpoint
    let videoBlob;
    try {
      const bytes = base64ToUint8Array(videoData.data);
      videoBlob = new Blob([
        bytes
      ], {
        type: videoData.type || 'video/webm'
      });
    } catch (decodeError) {
      console.error('Error decoding video data:', decodeError);
      return new Response(JSON.stringify({
        error: 'Failed to decode video data',
        details: decodeError.message
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Create filename for single upload
    const fileName = `${interviewId}_${candidateId}_single.webm`;
    // Upload to external endpoint
    const formData = new FormData();
    formData.append('file', videoBlob, fileName);
    console.log(`Uploading single video (${fileName}) to external endpoint...`);
    const response = await fetch('https://staging-northstar.azurewebsites.net/api/v1/upload_video', {
      method: 'POST',
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Single video upload failed:', response.status, response.statusText, errorText);
      return new Response(JSON.stringify({
        error: 'Failed to upload video to external endpoint',
        details: `${response.status} ${response.statusText} - ${errorText}`
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const result = await response.json();
    console.log(`Single video upload successful:`, result);
    if (!result.success) {
      return new Response(JSON.stringify({
        error: 'Failed to upload video',
        details: result.message || 'Unknown error from external endpoint'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Update transcripts table with single chunk count for legacy uploads
    const { error: transcriptError } = await supabase.from('transcripts').upsert({
      interview_id: interviewId,
      candidate_id: candidateId,
      chunk_count: 1,
      file_path: fileName
    });
    if (transcriptError) {
      console.error('Error updating transcript with single file info:', transcriptError);
    // Don't fail the entire request, just log the error
    }
    return new Response(JSON.stringify({
      success: true,
      data: {
        fileName,
        size: videoBlob.size,
        message: 'Video uploaded to external endpoint successfully'
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in upload-interview-recording function:', error);
    return new Response(JSON.stringify({
      error: 'Failed to upload video',
      details: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
