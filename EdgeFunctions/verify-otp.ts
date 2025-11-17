import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const handler = async (req)=>{
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { email, otp } = await req.json();
    if (!email || !otp) {
      return new Response(JSON.stringify({
        error: "Email and OTP are required"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    // Clean up expired OTPs first
    await supabase.rpc('cleanup_expired_otps');
    // Find valid OTP for this email
    const { data: storedOTP, error: fetchError } = await supabase.from('otps').select('*').eq('email', email).eq('verified', false).gt('expires_at', new Date().toISOString()).order('created_at', {
      ascending: false
    }).limit(1).maybeSingle();
    if (fetchError) {
      console.error('Error fetching OTP:', fetchError);
      return new Response(JSON.stringify({
        error: "Database error occurred"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    if (!storedOTP) {
      console.log(`No valid OTP found for email: ${email}`);
      return new Response(JSON.stringify({
        success: false,
        error: "No valid OTP found. Please generate a new OTP."
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
    // Verify OTP
    if (storedOTP.otp === otp) {
      console.log(`OTP verified successfully for email: ${email}`);
      // Mark OTP as verified
      const { error: updateError } = await supabase.from('otps').update({
        verified: true
      }).eq('id', storedOTP.id);
      if (updateError) {
        console.error('Error updating OTP status:', updateError);
      // Still return success since OTP was valid
      }
      return new Response(JSON.stringify({
        success: true,
        message: "OTP verified successfully!"
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    } else {
      console.log(`Invalid OTP for email: ${email}. Expected: ${storedOTP.otp}, Received: ${otp}`);
      return new Response(JSON.stringify({
        success: false,
        error: "Invalid OTP. Please check and try again."
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        }
      });
    }
  } catch (error) {
    console.error("Error in verify-otp function:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
};
serve(handler);
