// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseServiceKey);
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { action, email, otp, newPassword } = await req.json();
    console.log('Reset password request:', {
      action,
      email
    });
    switch(action){
      case 'sendOTP':
        return await handleSendOTP(email);
      case 'validateOTP':
        return await handleValidateOTP(email, otp);
      case 'resetPassword':
        return await handleResetPassword(email, newPassword);
      default:
        return new Response(JSON.stringify({
          error: 'Invalid action'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
    }
  } catch (error) {
    console.error('Reset password function error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
async function handleSendOTP(email) {
  console.log('Sending OTP to:', email);
  // Verify email exists in users table
  const { data: user, error: userError } = await supabase.from('users').select('id').eq('email', email).single();
  if (userError || !user) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Email not found in our system'
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  // Call external API to send OTP
  const response = await fetch('https://northstar.azurewebsites.net/api/v1/sendOTP', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email
    })
  });
  const data = await response.json();
  console.log('Send OTP response:', data);
  return new Response(JSON.stringify(data), {
    status: response.ok ? 200 : 400,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
async function handleValidateOTP(email, otp) {
  console.log('Validating OTP for:', email);
  // Call external API to validate OTP
  const response = await fetch('https://northstar.azurewebsites.net/api/v1/validateOTP', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      user_type: 'shurya-interview',
      otp
    })
  });
  const data = await response.json();
  console.log('Validate OTP response:', data);
  return new Response(JSON.stringify(data), {
    status: response.ok ? 200 : 400,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
async function handleResetPassword(email, newPassword) {
  console.log('Resetting password for:', email);
  // Update password in users table
  const { error } = await supabase.from('users').update({
    password: newPassword
  }).eq('email', email);
  if (error) {
    console.error('Error updating password:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to update password'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  console.log('Password updated successfully');
  return new Response(JSON.stringify({
    success: true,
    message: 'Password updated successfully'
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
