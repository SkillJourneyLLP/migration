import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Store for tracking uploaded chunks per uploadId
const uploadTracker = new Map();
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const body = await req.json();
    console.log('Request body:', JSON.stringify(body, null, 2));
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Handle finalization request
    if (body.finalize) {
      return await finalizeVideo(supabase, body);
    }
    // Handle chunk upload
    const { uploadId, chunkIndex, chunkData, chunkSize, videoType, candidateId, isPartialUpload = false, totalChunks = null, totalSize = null } = body;
    console.log(`Processing chunk upload - uploadId: ${uploadId}, chunkIndex: ${chunkIndex}, isPartialUpload: ${isPartialUpload}`);
    if (!uploadId || chunkIndex === undefined || !chunkData || !candidateId) {
      throw new Error('Missing required fields: uploadId, chunkIndex, chunkData, candidateId');
    }
    // Convert base64 to Uint8Array
    const binaryString = atob(chunkData);
    const bytes = new Uint8Array(binaryString.length);
    for(let i = 0; i < binaryString.length; i++){
      bytes[i] = binaryString.charCodeAt(i);
    }
    // Create folder path and file name
    const folderPath = `chunks_${uploadId}`;
    const fileName = `chunk_${chunkIndex.toString().padStart(6, '0')}.webm`;
    const fullPath = `${folderPath}/${fileName}`;
    console.log(`Uploading chunk to path: ${fullPath}, size: ${bytes.length} bytes`);
    // Upload chunk to video-recordings bucket
    const { data, error } = await supabase.storage.from('video-recordings').upload(fullPath, bytes, {
      contentType: videoType || 'video/webm',
      upsert: true // Allow overwriting for retry scenarios
    });
    if (error) {
      console.error('Storage upload error:', error);
      throw error;
    }
    // Track uploaded chunks
    if (!uploadTracker.has(uploadId)) {
      uploadTracker.set(uploadId, {
        chunks: new Set(),
        candidateId,
        videoType: videoType || 'video/webm',
        totalSize: totalSize || 0,
        totalChunks: totalChunks || 0
      });
    }
    const tracker = uploadTracker.get(uploadId);
    tracker.chunks.add(chunkIndex);
    // Update metadata if provided
    if (totalChunks !== null) tracker.totalChunks = totalChunks;
    if (totalSize !== null) tracker.totalSize = totalSize;
    console.log(`Successfully uploaded chunk ${chunkIndex} for uploadId ${uploadId}. Total chunks uploaded: ${tracker.chunks.size}`);
    return new Response(JSON.stringify({
      success: true,
      message: `Chunk ${chunkIndex} uploaded successfully`,
      data: {
        path: data?.path,
        chunkIndex,
        uploadId,
        totalUploaded: tracker.chunks.size
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in upload-video-chunk:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
async function finalizeVideo(supabase, body) {
  const { uploadId, totalChunks, videoType, totalSize, candidateId } = body;
  console.log(`Finalizing video for uploadId: ${uploadId}, totalChunks: ${totalChunks}`);
  if (!uploadId || !candidateId) {
    throw new Error('Missing required fields for finalization: uploadId, candidateId');
  }
  const tracker = uploadTracker.get(uploadId);
  if (!tracker) {
    throw new Error(`No upload tracker found for uploadId: ${uploadId}`);
  }
  try {
    // List all uploaded chunks
    const folderPath = `chunks_${uploadId}`;
    const { data: fileList, error: listError } = await supabase.storage.from('video-recordings').list(folderPath);
    if (listError) {
      console.error('Error listing chunks:', listError);
      throw listError;
    }
    if (!fileList || fileList.length === 0) {
      throw new Error('No chunks found to finalize');
    }
    console.log(`Found ${fileList.length} chunks to combine`);
    // Sort chunks by name to ensure correct order
    const sortedChunks = fileList.filter((file)=>file.name.startsWith('chunk_')).sort((a, b)=>a.name.localeCompare(b.name));
    // Download and combine all chunks
    const chunkBuffers = [];
    for (const chunk of sortedChunks){
      const chunkPath = `${folderPath}/${chunk.name}`;
      console.log(`Downloading chunk: ${chunkPath}`);
      const { data: chunkData, error: downloadError } = await supabase.storage.from('video-recordings').download(chunkPath);
      if (downloadError) {
        console.error(`Error downloading chunk ${chunk.name}:`, downloadError);
        throw downloadError;
      }
      const arrayBuffer = await chunkData.arrayBuffer();
      chunkBuffers.push(new Uint8Array(arrayBuffer));
    }
    // Combine all chunks into a single video file
    const totalLength = chunkBuffers.reduce((sum, buffer)=>sum + buffer.length, 0);
    const combinedVideo = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of chunkBuffers){
      combinedVideo.set(buffer, offset);
      offset += buffer.length;
    }
    console.log(`Combined video size: ${combinedVideo.length} bytes`);
    // Upload the final combined video
    const finalVideoPath = `${candidateId}/${uploadId}.webm`;
    const { data: finalUpload, error: finalError } = await supabase.storage.from('video-recordings').upload(finalVideoPath, combinedVideo, {
      contentType: videoType || 'video/webm',
      upsert: true
    });
    if (finalError) {
      console.error('Error uploading final video:', finalError);
      throw finalError;
    }
    console.log(`Final video uploaded successfully: ${finalUpload.path}`);
    // Clean up chunk files
    try {
      for (const chunk of sortedChunks){
        const chunkPath = `${folderPath}/${chunk.name}`;
        await supabase.storage.from('video-recordings').remove([
          chunkPath
        ]);
      }
      console.log(`Cleaned up ${sortedChunks.length} chunk files`);
    } catch (cleanupError) {
      console.warn('Error during cleanup:', cleanupError);
    // Don't fail the finalization if cleanup fails
    }
    // Remove from tracker
    uploadTracker.delete(uploadId);
    return new Response(JSON.stringify({
      success: true,
      message: 'Video finalized successfully',
      data: {
        folderPath: finalVideoPath,
        uploadId,
        finalSize: combinedVideo.length,
        chunksProcessed: sortedChunks.length
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error finalizing video:', error);
    throw error;
  }
}
