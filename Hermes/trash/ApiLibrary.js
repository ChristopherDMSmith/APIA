// ApiLibrary.js - Handle API-related functionality
import { UIUtils, Logger, ApiClient } from './utils.js';

export default class ApiLibrary {
    static lastRequestDetails = null;

    static async loadLibrary() {
        try {
            const response = await fetch("apilibrary/apilibrary.json");
            if (!response.ok) {
                throw new Error(`Failed to load API Library: ${response.status}`);
            }
            const apiLibraryData = await response.json();
            return apiLibraryData.apiLibrary;
        } catch (error) {
            Logger.error("Error loading API Library:", error);
            return {};
        }
    }

    static async populateDropdown() {
        try {
            const apiLibrary = await this.loadLibrary();
            const apiDropdown = document.getElementById("api-selector");
            if (!apiDropdown) {
                throw new Error("API dropdown element not found");
            }

            apiDropdown.innerHTML = '<option value="" disabled selected>Select API...</option>';

            Object.entries(apiLibrary)
                .filter(([key]) => !key.startsWith('_'))
                .forEach(([key, api]) => {
                    const option = document.createElement("option");
                    option.value = key;
                    option.textContent = api.name;
                    apiDropdown.appendChild(option);
                });

        } catch (error) {
            Logger.error("Error populating API dropdown:", error);
        }
    }

    static clearParameters() {
        const containers = [
            document.getElementById("query-parameters-container"),
            document.getElementById("body-parameters-container")
        ];

        containers.forEach(container => {
            if (container) container.innerHTML = "";
        });
    }

    static async populateParameters(selectedApiKey) {
        try {
            const apiLibrary = await this.loadLibrary();
            const selectedApi = apiLibrary[selectedApiKey];

            if (!selectedApi) return;

            await Promise.all([
                this.populateQueryParameters(selectedApi, selectedApiKey),
                this.populateBodyParameters(selectedApi, selectedApiKey)
            ]);

        } catch (error) {
            Logger.error("Error populating parameters:", error);
        }
    }

    static async populateQueryParameters(selectedApi, selectedApiKey) {
        const queryContainer = document.getElementById("query-parameters-container");
        if (!queryContainer) return;

        queryContainer.innerHTML = "";

        if (selectedApiKey === "adHocGet" || selectedApiKey === "adHocPost") {
            const queryHeader = document.createElement("div");
            queryHeader.className = "parameter-header";
            queryHeader.textContent = "Endpoint URL with Query Parameters";
            queryContainer.appendChild(queryHeader);

            const endpointInput = document.createElement("input");
            endpointInput.type = "text";
            endpointInput.id = "adhoc-endpoint";
            endpointInput.classList.add("query-param-input");
            endpointInput.placeholder = "/v1/endpoint?queryParam=value";

            queryContainer.appendChild(endpointInput);
            return;
        }

        // Add standard query parameters handling here
        if (selectedApi.queryParameters) {
            const queryHeader = document.createElement("div");
            queryHeader.className = "parameter-header";
            queryHeader.textContent = "Query Parameters";
            queryContainer.appendChild(queryHeader);

            selectedApi.queryParameters.forEach(param => {
                const paramWrapper = document.createElement("div");
                paramWrapper.classList.add("query-param-wrapper");

                const label = document.createElement("label");
                label.textContent = `${param.name}:`;
                paramWrapper.appendChild(label);

                const input = document.createElement("input");
                input.type = param.type || "text";
                input.id = `query-${param.name}`;
                input.classList.add("query-param-input");
                input.placeholder = param.description || "Enter value";
                
                if (param.defaultValue) {
                    input.value = param.defaultValue;
                }

                paramWrapper.appendChild(input);
                queryContainer.appendChild(paramWrapper);
            });
        }
    }

    static async populateBodyParameters(selectedApi, selectedApiKey) {
        const bodyContainer = document.getElementById("body-parameters-container");
        if (!bodyContainer) return;

        bodyContainer.innerHTML = "";

        if (selectedApiKey === "adHocPost") {
            const bodyHeader = document.createElement("div");
            bodyHeader.className = "parameter-header";
            bodyHeader.textContent = "Full JSON Body";
            bodyContainer.appendChild(bodyHeader);

            const textarea = document.createElement("textarea");
            textarea.id = "adhoc-body";
            textarea.className = "json-textarea";
            textarea.placeholder = "Enter full JSON body here...";
            bodyContainer.appendChild(textarea);
            return;
        }

        if (selectedApi.bodyParameters) {
            const bodyHeader = document.createElement("div");
            bodyHeader.className = "parameter-header";
            bodyHeader.textContent = "Body Parameters";
            bodyContainer.appendChild(bodyHeader);

            selectedApi.bodyParameters.forEach(param => {
                const paramWrapper = document.createElement("div");
                paramWrapper.classList.add("body-param-wrapper");

                const label = document.createElement("label");
                label.textContent = param.name;
                paramWrapper.appendChild(label);

                if (param.type === "select") {
                    const select = document.createElement("select");
                    select.classList.add("body-param-input");
                    select.dataset.path = param.path;
                    
                    param.options.forEach(option => {
                        const optionElement = document.createElement("option");
                        optionElement.value = option;
                        optionElement.textContent = option;
                        select.appendChild(optionElement);
                    });

                    paramWrapper.appendChild(select);
                } else {
                    const input = document.createElement("input");
                    input.type = param.type || "text";
                    input.classList.add("body-param-input");
                    input.dataset.path = param.path;
                    input.placeholder = param.description || "Enter value";

                    if (param.defaultValue) {
                        input.value = param.defaultValue;
                    }

                    paramWrapper.appendChild(input);
                }

                bodyContainer.appendChild(paramWrapper);
            });
        }
    }

    static async handleApiSelection(value) {
        this.clearParameters();
        await this.populateParameters(value);
    }

    static async handleApiExecution() {
        const button = document.getElementById("execute-api");
        button.disabled = true;

        try {
            const response = await this.executeApiCall();
            UIUtils.setButtonTempText(button, "Success!");
            return response;
        } catch (error) {
            Logger.error("API execution failed:", error);
            UIUtils.setButtonFailText(button, "Failed!");
            throw error;
        } finally {
            button.disabled = false;
        }
    }

    static async executeApiCall() {
        // Add your API execution logic here
        // This should include building the request and making the API call
    }

    // Add other API Library methods as needed
}