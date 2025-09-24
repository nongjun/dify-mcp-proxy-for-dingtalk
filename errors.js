/**
 * MCP 代理服务器错误处理模块
 * 定义标准错误代码和错误响应格式
 */

// 标准 JSON-RPC 2.0 错误代码
const ErrorCodes = {
  // 标准错误码
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  
  // 自定义错误码
  SERVER_UNAVAILABLE: -32001,
  REQUEST_TIMEOUT: -32002,
  CIRCUIT_BREAKER_OPEN: -32003,
  PROXY_ERROR: -32004
};

/**
 * 创建标准 JSON-RPC 错误响应
 * @param {number} code - 错误代码
 * @param {string} message - 错误消息
 * @param {*} data - 附加数据（可选）
 * @param {*} id - 请求 ID（可选）
 * @returns {Object} JSON-RPC 错误响应对象
 */
function createErrorResponse(code, message, data = null, id = null) {
  const response = {
    jsonrpc: "2.0",
    error: {
      code,
      message
    }
  };
  
  if (data !== null) {
    response.error.data = data;
  }
  
  if (id !== null) {
    response.id = id;
  }
  
  return response;
}

/**
 * 处理代理转发错误
 * @param {Error} error - 原始错误对象
 * @param {string} serverId - 服务器 ID
 * @returns {Object} 标准化的错误响应
 */
function handleProxyError(error, serverId) {
  // 网络连接错误
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return createErrorResponse(
      ErrorCodes.SERVER_UNAVAILABLE,
      `无法连接到 Dify 服务 (${serverId})`,
      { retry_after: 30, server_id: serverId }
    );
  }
  
  // 超时错误
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return createErrorResponse(
      ErrorCodes.REQUEST_TIMEOUT,
      '请求超时，请稍后重试',
      { timeout: true, server_id: serverId }
    );
  }
  
  // HTTP 响应错误
  if (error.response) {
    const status = error.response.status;
    const message = `Dify 服务器错误: ${status}`;
    
    return createErrorResponse(
      ErrorCodes.PROXY_ERROR,
      message,
      { 
        status_code: status,
        server_id: serverId,
        response_data: error.response.data
      }
    );
  }
  
  // 未知错误
  console.error('未处理的代理错误:', error);
  return createErrorResponse(
    ErrorCodes.INTERNAL_ERROR,
    '内部服务器错误',
    { server_id: serverId }
  );
}

module.exports = {
  ErrorCodes,
  createErrorResponse,
  handleProxyError
};
